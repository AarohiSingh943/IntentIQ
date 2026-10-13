import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.services.composer import Composer, PlanError, PlanRequest, PlanResponse

router = APIRouter(prefix="/api/plan", tags=["plan"])
logger = get_logger("plan_api")


def _composer(request: Request) -> Composer:
    return request.app.state.composer


@router.post("", response_model=PlanResponse, summary="Compile a wish into a routed itinerary")
async def create_plan(payload: PlanRequest, request: Request) -> PlanResponse:
    try:
        return await _composer(request).compose(payload)
    except PlanError as exc:
        raise HTTPException(status_code=exc.status, detail={"error": exc.code, "detail": exc.detail}) from exc


@router.post("/stream", summary="Same as /api/plan, streamed as server-sent events")
async def stream_plan(payload: PlanRequest, request: Request) -> StreamingResponse:
    composer = _composer(request)

    async def events() -> AsyncIterator[bytes]:
        try:
            async for event, data in composer.stream(payload):
                yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()
            yield b"event: done\ndata: {}\n\n"
        except PlanError as exc:
            yield f"event: error\ndata: {json.dumps({'error': exc.code, 'detail': exc.detail})}\n\n".encode()
        except Exception:  # noqa: BLE001
            logger.exception("plan stream failed")
            yield b'event: error\ndata: {"error": "internal", "detail": "Something broke while planning. Try again."}\n\n'

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"cache-control": "no-store", "x-accel-buffering": "no"},
    )
