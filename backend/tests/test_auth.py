from sqlalchemy import text

from conftest import admin_headers, auth, make_authority, register_citizen


async def test_citizen_register_login_me(client):
    s = await register_citizen(client, email="Asha@Example.com")
    assert s["user"]["role"] == "citizen" and s["user"]["area"] == "Andheri West"
    assert s["user"]["email"] == "asha@example.com"
    assert "password" not in str(s).lower().replace("password_hash", "")
    me = await client.get("/me", headers=s["headers"])
    assert me.status_code == 200 and me.json()["name"] == "Asha Citizen"

    r = await client.post("/auth/login", json={"email": "asha@example.com", "password": "citizen-pass-1", "role": "citizen"})
    assert r.status_code == 200


async def test_duplicate_email_and_bad_password(client):
    await register_citizen(client, email="dup@example.com")
    r = await client.post("/auth/register", json={"role": "citizen", "name": "X", "email": "DUP@example.com", "password": "another-pass", "consent": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"
    r = await client.post("/auth/login", json={"email": "dup@example.com", "password": "wrong-pass", "role": "citizen"})
    assert r.status_code == 401 and r.json() == {"error": {"code": "invalid_credentials", "message": "Email or password is incorrect for this account type."}}
    # right password, wrong account type
    r = await client.post("/auth/login", json={"email": "dup@example.com", "password": "citizen-pass-1", "role": "authority"})
    assert r.status_code == 401


async def test_validation_errors_use_one_shape(client):
    r = await client.post("/auth/register", json={"role": "citizen", "name": "X", "email": "not-an-email", "password": "short", "consent": True})
    assert r.status_code == 422 and set(r.json()["error"]) == {"code", "message"}
    r = await client.post("/auth/register", json={"role": "admin", "name": "X", "email": "a@b.co", "password": "long-enough-1", "consent": True})
    assert r.status_code == 422  # nobody can register as admin
    r = await client.post("/auth/register", json={"role": "citizen", "name": "X", "email": "a@b.co", "password": "long-enough-1", "consent": False})
    assert r.json()["error"]["code"] == "consent_required"


async def test_authority_pending_until_approved(client):
    email = "officer@bmc.example.com"
    r = await client.post("/auth/register", json={"role": "authority", "name": "Officer", "email": email, "password": "officer-pass-1", "department": "Roads & Traffic", "employee_id": "BMC-1", "area": "Fort", "consent": True})
    assert r.status_code == 201 and r.json()["pending"] is True and "admin will verify" in r.json()["message"]
    login = {"email": email, "password": "officer-pass-1", "role": "authority"}
    r = await client.post("/auth/login", json=login)
    assert r.status_code == 403 and r.json()["error"]["code"] == "approval_pending"

    admin = await admin_headers(client)
    [pending] = (await client.get("/admin/authorities?approval=pending", headers=admin)).json()
    r = await client.post(f"/admin/authorities/{pending['id']}/decision", json={"decision": "approve"}, headers=admin)
    assert r.json()["approval"] == "approved"
    r = await client.post("/auth/login", json=login)
    assert r.status_code == 200
    token = r.json()["access_token"]
    me = (await client.get("/me", headers=auth(token))).json()
    assert me["department"] == "Roads & Traffic" and me["employee_id"] == "BMC-1"

    # revoke: the existing access token stops working immediately
    r = await client.post(f"/admin/authorities/{pending['id']}/decision", json={"decision": "revoke"}, headers=admin)
    assert r.json()["approval"] == "rejected"
    assert (await client.get("/me", headers=auth(token))).status_code == 403
    r = await client.post("/auth/login", json=login)
    assert r.json()["error"]["code"] == "approval_rejected"


async def test_refresh_rotation_and_reuse_detection(client):
    await register_citizen(client, email="rot@example.com")
    first_cookie = client.cookies.get("ireport_refresh")
    assert first_cookie
    r = await client.post("/auth/refresh")
    assert r.status_code == 200 and r.json()["user"]["email"] == "rot@example.com"
    second_cookie = client.cookies.get("ireport_refresh")
    assert second_cookie and second_cookie != first_cookie

    # two tabs refreshing at the same moment: the late one gets "refresh_race", nothing is revoked
    client.cookies.set("ireport_refresh", first_cookie, domain="api.test", path="/api/v1/auth")
    r = await client.post("/auth/refresh")
    assert r.status_code == 401 and r.json()["error"]["code"] == "refresh_race"
    client.cookies.set("ireport_refresh", second_cookie, domain="api.test", path="/api/v1/auth")
    assert (await client.post("/auth/refresh")).status_code == 200
    third_cookie = client.cookies.get("ireport_refresh")

    # replaying an old token later is treated as theft: all sessions end
    from app.db import engine

    async with engine.begin() as conn:
        await conn.execute(text("UPDATE refresh_tokens SET revoked_at = revoked_at - interval '5 minutes' WHERE revoked_at IS NOT NULL"))
    client.cookies.set("ireport_refresh", first_cookie, domain="api.test", path="/api/v1/auth")
    r = await client.post("/auth/refresh")
    assert r.status_code == 401 and r.json()["error"]["code"] == "no_session"
    client.cookies.set("ireport_refresh", third_cookie, domain="api.test", path="/api/v1/auth")
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_logout_revokes_refresh(client):
    await register_citizen(client)
    assert (await client.post("/auth/logout")).status_code == 204
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_login_rate_limited(client):
    body = {"email": "nobody@example.com", "password": "whatever-1", "role": "citizen"}
    codes = [(await client.post("/auth/login", json=body)).status_code for _ in range(12)]
    assert codes[:10] == [401] * 10 and codes[-1] == 429


async def test_role_checks(client):
    c = await register_citizen(client)
    assert (await client.get("/admin/stats", headers=c["headers"])).status_code == 403
    assert (await client.get("/admin/stats")).status_code == 401
    assert (await client.get("/me", headers=auth("garbage"))).status_code == 401
    officer = await make_authority(client)
    assert (await client.get("/admin/authorities", headers=officer["headers"])).status_code == 403


async def test_patch_me_export_and_delete(client):
    c = await register_citizen(client, email="del@example.com")
    r = await client.patch("/me", json={"name": "Asha  K", "phone": "+91 98200 00000", "area": "Bandra", "lang": "mr"}, headers=c["headers"])
    assert r.json()["name"] == "Asha K" and r.json()["area"] == "Bandra" and r.json()["lang"] == "mr"
    assert (await client.patch("/me", json={"area": "Atlantis"}, headers=c["headers"])).status_code == 422
    export = (await client.get("/me/export", headers=c["headers"])).json()
    assert export["profile"]["email"] == "del@example.com" and export["reports"] == []

    assert (await client.delete("/me", headers=c["headers"])).status_code == 204
    assert (await client.get("/me", headers=c["headers"])).status_code == 401
    r = await client.post("/auth/login", json={"email": "del@example.com", "password": "citizen-pass-1", "role": "citizen"})
    assert r.status_code == 401
    # the email can be used again
    await register_citizen(client, email="del@example.com")


async def test_admin_stats(client):
    await register_citizen(client)
    await make_authority(client, approve=False)
    s = (await client.get("/admin/stats", headers=await admin_headers(client))).json()
    assert s == {"pending": 1, "approved": 0, "rejected": 0, "citizens": 1, "incidents": 0, "reports": 0}


async def test_health(client):
    assert (await client.get("/health")).json() == {"status": "ok"}
    r = await client.get("/ready")
    assert r.status_code == 200 and r.json()["checks"]["database"] == "ok"
