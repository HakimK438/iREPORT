from fastapi import FastAPI

from sqlalchemy import text
from .database import Base, engine
from . import models

app = FastAPI(
    title="AI Civic Reporter",
    description="AI-powered platform for reporting and managing civic issues",
    version="0.1.0"
)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

@app.get("/")
def root():
    return {
        "message": "AI Civic Reporter API is running"
    }

@app.get("/health/db")
def database_health():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return {
            "database": "connected"
        }

    except Exception as e:
        return {
            "database": "error",
            "details": str(e)
        }