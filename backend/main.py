from fastapi import FastAPI

app = FastAPI(
    title="AI Civic Reporter",
    version="0.1.0"
)


@app.get("/")
def root():
    return {
        "message": "AI Civic Reporter API is running"
    }