import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.catalog.routes import router as catalog_router
from app.config import settings
from app.credentials.routes import router as credentials_router
from app.db.session import engine
from app.flows.files import router as flow_files_router
from app.flows.routes import router as flows_router
from app.integrations.routes import router as integrations_router
from app.logging_config import configure_logging
from app.lzt_accounts.routes import router as lzt_accounts_router
from app.owner import ensure_local_owner
from app.security.headers import RequestIdMiddleware, SecurityHeadersMiddleware
from app.security.request_context import REQUEST_ID_HEADER, get_request_id
from app.webhooks.routes import router as webhooks_router

configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_local_owner()
    yield
    from app.engine.executor import shutdown_thread_pool

    shutdown_thread_pool()
    await engine.dispose()


_docs = None if settings.is_production else "/docs"
_openapi = None if settings.is_production else "/openapi.json"
_redoc = None if settings.is_production else "/redoc"

app = FastAPI(
    title="LZT Builder API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=_docs,
    openapi_url=_openapi,
    redoc_url=_redoc,
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[REQUEST_ID_HEADER],
)
# Outermost: assign request_id before anything else so it appears in every log/response.
app.add_middleware(RequestIdMiddleware)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    request_id = get_request_id()
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "request_id": request_id},
        headers={REQUEST_ID_HEADER: request_id, **(exc.headers or {})},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = get_request_id()
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(exc.errors()), "request_id": request_id},
        headers={REQUEST_ID_HEADER: request_id},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = get_request_id()
    logger.exception("Unhandled error for %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": request_id},
        headers={REQUEST_ID_HEADER: request_id},
    )

app.include_router(flows_router)
app.include_router(flow_files_router)
app.include_router(lzt_accounts_router)
app.include_router(catalog_router)
app.include_router(integrations_router)
app.include_router(credentials_router)
app.include_router(webhooks_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
