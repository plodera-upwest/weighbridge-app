# AI Product Counting Service

This optional local service reads an RTSP camera stream and exposes product counts to the web app AI Product Counting module.

## Install

```powershell
pip install -r ai-service/requirements.txt
```

## Run

Do not store camera passwords in the repo. Put the RTSP URL in an environment variable before starting the service.

```powershell
$env:AI_RTSP_URL="rtsp://admin:PASSWORD@192.168.13.76:554/stream1"
python ai-service/product_counter.py
```

The service runs at:

```text
http://127.0.0.1:5055
```

In the app settings, set **AI service URL** to `http://127.0.0.1:5055`.

## Notes

- This first version counts moving objects crossing a horizontal line.
- For high accuracy on billets, collect sample camera footage and train a billet-specific detection model later.
- Keep the AI service on the local operator machine if the camera is only accessible on the factory LAN.
