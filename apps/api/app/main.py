from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes.geocode import router as geocode_router
from app.api.routes.meta import router as meta_router
from app.api.routes.plan import router as plan_router
from app.api.routes.plans import router as plans_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging, get_logger
from app.core.middleware import RateLimitMiddleware, RequestContextMiddleware
from app.services.composer import Composer
from app.services.geocode import GeocodeClient
from app.services.llm import build_intent_model
from app.services.overpass import OverpassClient
from app.services.weather import WeatherClient
from app.storage.plans import PlanStore

logger = get_logger("main")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging("DEBUG" if settings.debug else "INFO", settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.overpass = OverpassClient(settings)
        app.state.intent_model = build_intent_model(settings)
        app.state.geocode = GeocodeClient(settings)
        app.state.weather = WeatherClient(settings) if settings.weather_enabled else None
        app.state.composer = Composer(settings, app.state.overpass, app.state.intent_model, app.state.weather, app.state.geocode)
        app.state.plans = PlanStore(settings.database_path)
        logger.info(
            "%s %s ready (env=%s, llm=%s)",
            settings.app_name,
            settings.version,
            settings.environment,
            app.state.intent_model.name if app.state.intent_model else "rules only",
        )
        yield

    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description="Compiles a sentence about your next few hours into a timed, routed, explainable itinerary.",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(RateLimitMiddleware, limits={"/api/plan": settings.rate_limit_per_minute, "/api/geocode": settings.geocode_rate_limit_per_minute})
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["x-request-id", "x-response-time-ms"],
    )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {"error": "http_error", "detail": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={**detail, "request_id": getattr(request.state, "request_id", None)})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return JSONResponse(
            status_code=422,
            content={"error": "invalid_request", "detail": f"{where}: {first.get('msg', 'invalid')}", "request_id": getattr(request.state, "request_id", None)},
        )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error")
        return JSONResponse(status_code=500, content={"error": "internal", "detail": "Something broke. It has been logged.", "request_id": getattr(request.state, "request_id", None)})

    app.include_router(meta_router)
    app.include_router(geocode_router)
    app.include_router(plan_router)
    app.include_router(plans_router)
    _mount_web(app, settings)
    return app


def _mount_web(app: FastAPI, settings: Settings) -> None:
    dist = Path(settings.web_dist_dir).resolve()
    index = dist / "index.html"
    if not index.exists():
        return
    assets = dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        candidate = dist / path
        if path and candidate.is_file() and candidate.resolve().is_relative_to(dist):
            return FileResponse(candidate)
        return FileResponse(index)

    logger.info("serving web app from %s", dist)


app = create_app()
