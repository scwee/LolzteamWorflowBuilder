from celery import Celery

from app.config import settings
from app.logging_config import configure_logging

configure_logging()

celery_app = Celery(
    "lztbuilder",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    result_expires=3600,
    beat_schedule={
        "process-active-flow-loops": {
            "task": "app.tasks.flow_tasks.process_active_loops",
            "schedule": 30.0,
        },
        "process-cron-schedules": {
            "task": "app.tasks.flow_tasks.process_cron_schedules",
            "schedule": 60.0,
        },
    },
)

celery_app.autodiscover_tasks(["app.tasks"])


from celery.signals import worker_shutdown  # noqa: E402


@worker_shutdown.connect
def _release_engine_threads(**_kwargs) -> None:
    from app.engine.executor import shutdown_thread_pool

    shutdown_thread_pool()
