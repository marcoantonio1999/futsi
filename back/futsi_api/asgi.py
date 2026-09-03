import os

from django.core.asgi import get_asgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "futsi_api.settings")

django_application = get_asgi_application()


async def application(scope, receive, send):
    if scope["type"] == "websocket":
        if scope.get("path") == "/ws/voice/twilio/":
            # Import only after Django has initialized the app registry.
            from core.voice.realtime import twilio_media_stream_application

            await twilio_media_stream_application(scope, receive, send)
            return
        await send({"type": "websocket.close", "code": 4404})
        return
    await django_application(scope, receive, send)
