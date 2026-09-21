import base64, json, mimetypes, os, random, time, uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib import request, parse, error
from pathlib import Path

HOST = "0.0.0.0"
PORT = int(os.environ.get("VISTA_PORT", "3000"))
COMFY = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
CHECKPOINT_OVERRIDE = os.environ.get("VISTA_CHECKPOINT", "").strip()
ROOT = Path(__file__).resolve().parent
MAX_BODY = 12 * 1024 * 1024

STYLES = {
    "modern": "modern minimalist interior, refined neutral palette, clean architectural detailing",
    "cream": "warm creamy interior, soft beige palette, matte surfaces, elegant diffused lighting",
    "wabisabi": "wabi-sabi interior, microcement, natural timber, restrained earthy materiality",
    "nordic": "Scandinavian interior, pale oak, bright natural light, functional simplicity",
    "japandi": "Japandi interior, Japanese restraint with Scandinavian warmth",
    "luxury": "understated modern luxury, refined stone, brushed metal, sophisticated soft light",
    "zen": "calm East Asian Zen atmosphere, balanced natural wood and stone"
}

NEGATIVE = """cartoon, illustration, anime, low quality, blurry, plastic CGI, oversaturated,
warped architecture, bent wall, crooked cabinet, distorted perspective, extra furniture,
missing furniture, duplicated object, melted object, floating object, bad geometry,
fisheye, extreme wide angle, overexposed, crushed blacks, fake HDR, excessive bloom,
text, watermark, logo, people, hands"""

def http_json(url, method="GET", payload=None, timeout=20):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = request.Request(url, data=data, headers=headers, method=method)
    with request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def comfy_online():
    try:
        http_json(COMFY + "/system_stats", timeout=3)
        return True
    except Exception:
        return False

def checkpoint_list():
    try:
        info = http_json(COMFY + "/object_info/CheckpointLoaderSimple", timeout=8)
        node = info.get("CheckpointLoaderSimple", {})
        return node.get("input", {}).get("required", {}).get("ckpt_name", [[]])[0] or []
    except Exception:
        return []

def choose_checkpoint():
    items = checkpoint_list()
    if CHECKPOINT_OVERRIDE:
        if CHECKPOINT_OVERRIDE in items:
            return CHECKPOINT_OVERRIDE
        raise RuntimeError("VISTA_CHECKPOINT 找不到：" + CHECKPOINT_OVERRIDE)
    if not items:
        raise RuntimeError("ComfyUI 沒有找到任何 checkpoint。請先把 SDXL 模型放進 ComfyUI/models/checkpoints。")
    preferred = [x for x in items if any(k in x.lower() for k in ["xl", "sdxl", "realvis", "juggernaut"])]
    return preferred[0] if preferred else items[0]

def multipart_upload(filename, raw, mime="image/jpeg"):
    boundary = "----VISTA" + uuid.uuid4().hex
    parts = []
    def field(name, value):
        parts.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").encode())
    field("type", "input")
    field("overwrite", "true")
    head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode()
    body = b"".join(parts) + head + raw + b"\r\n" + f"--{boundary}--\r\n".encode()
    req = request.Request(COMFY + "/upload/image", data=body, method="POST",
                          headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def build_prompt(body):
    style = STYLES.get(body.get("style"), STYLES["modern"])
    lighting = str(body.get("lighting") or "natural daylight with soft realistic bounced light")[:300]
    extra = str(body.get("userPrompt") or "")[:1000]
    mode = body.get("mode", "pure")
    base = """high-end photorealistic architectural interior photography, physically plausible PBR materials,
realistic wood grain scale, subtle stone roughness, realistic glass Fresnel reflections, natural fabric fibers,
soft global illumination, contact shadows, ambient occlusion, balanced exposure, realistic highlight rolloff,
straight architectural lines, coherent perspective, professional interior photography"""
    if mode == "style":
        base += ", " + style
    if lighting:
        base += ", " + lighting
    if extra:
        base += ", " + extra
    return base

def workflow(input_name, body, checkpoint):
    # RTX 5060 8GB default: SDXL img2img. Low denoise keeps the original geometry stable.
    quality = body.get("quality", "standard")
    denoise = float(body.get("denoise", 0.28))
    denoise = max(0.18, min(0.45, denoise))
    steps = 24 if quality == "standard" else 28
    cfg = 5.0
    positive = build_prompt(body)

    return {
      "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
      "2": {"class_type": "LoadImage", "inputs": {"image": input_name}},
      "3": {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["1", 2]}},
      "4": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["1", 1]}},
      "5": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["1", 1]}},
      "6": {"class_type": "KSampler", "inputs": {
          "seed": random.randint(1, 2**31 - 1),
          "steps": steps,
          "cfg": cfg,
          "sampler_name": "dpmpp_2m",
          "scheduler": "karras",
          "denoise": denoise,
          "model": ["1", 0],
          "positive": ["4", 0],
          "negative": ["5", 0],
          "latent_image": ["3", 0]
      }},
      "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
      "8": {"class_type": "SaveImage", "inputs": {"filename_prefix": "VISTA_LOCAL", "images": ["7", 0]}}
    }

def wait_output(prompt_id, timeout=300):
    start = time.time()
    while time.time() - start < timeout:
        try:
            hist = http_json(COMFY + "/history/" + prompt_id, timeout=10)
            item = hist.get(prompt_id)
            if item:
                outputs = item.get("outputs", {})
                for out in outputs.values():
                    imgs = out.get("images", [])
                    if imgs:
                        return imgs[0]
                status = item.get("status", {})
                if status.get("status_str") == "error":
                    raise RuntimeError("ComfyUI 工作流程執行失敗。請查看 ComfyUI 視窗錯誤。")
        except error.HTTPError:
            pass
        time.sleep(1.0)
    raise TimeoutError("算圖超過 5 分鐘，請降低圖片尺寸或確認顯存。")

def get_output_image(meta):
    q = parse.urlencode({
        "filename": meta["filename"],
        "subfolder": meta.get("subfolder", ""),
        "type": meta.get("type", "output")
    })
    with request.urlopen(COMFY + "/view?" + q, timeout=30) as r:
        raw = r.read()
        mime = r.headers.get_content_type() or "image/png"
        return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")

class Handler(BaseHTTPRequestHandler):
    server_version = "VISTA-Local/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.address_string(), fmt % args))

    def send_json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.startswith("/api/health"):
            online = comfy_online()
            cps = checkpoint_list() if online else []
            return self.send_json(200, {
                "ok": online and bool(cps),
                "comfyui": online,
                "checkpoints": cps[:12],
                "selectedCheckpoint": (CHECKPOINT_OVERRIDE or (cps[0] if cps else None)),
                "mode": "local-free",
                "port": PORT
            })

        target = ROOT / "index-local.html" if self.path in ["/", "/index.html", "/index-local.html"] else None
        if target and target.exists():
            raw = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            return self.wfile.write(raw)

        self.send_error(404)

    def do_POST(self):
        if self.path != "/api/render":
            return self.send_json(404, {"error": "Not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > MAX_BODY:
                return self.send_json(413, {"error": "上傳內容過大。"})
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            image = str(body.get("image") or "")
            if not image.startswith("data:image/"):
                return self.send_json(400, {"error": "請先上傳底圖。"})

            header, encoded = image.split(",", 1)
            mime = header.split(";")[0].split(":")[1]
            raw = base64.b64decode(encoded)
            ext = ".png" if "png" in mime else ".webp" if "webp" in mime else ".jpg"
            name = "vista_" + uuid.uuid4().hex[:10] + ext

            if not comfy_online():
                return self.send_json(503, {"error": "找不到 ComfyUI。請先啟動 ComfyUI，再重新整理網頁。"})

            cp = choose_checkpoint()
            up = multipart_upload(name, raw, mime)
            input_name = up.get("name") or name
            wf = workflow(input_name, body, cp)

            queued = http_json(COMFY + "/prompt", method="POST", payload={
                "prompt": wf, "client_id": "vista-" + uuid.uuid4().hex
            }, timeout=30)
            prompt_id = queued.get("prompt_id")
            if not prompt_id:
                raise RuntimeError("ComfyUI 沒有回傳 prompt_id：" + json.dumps(queued, ensure_ascii=False)[:500])

            output = wait_output(prompt_id)
            result = get_output_image(output)
            return self.send_json(200, {
                "image": result,
                "engine": "ComfyUI Local SDXL",
                "checkpoint": cp,
                "promptId": prompt_id
            })
        except error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8", "ignore")[:1000]
            except Exception:
                detail = str(e)
            return self.send_json(502, {"error": "ComfyUI API 錯誤：" + detail})
        except Exception as e:
            print("ERROR:", repr(e))
            return self.send_json(500, {"error": str(e)})

if __name__ == "__main__":
    print("=" * 62)
    print(" VISTA LOCAL AI RENDER")
    print(" ComfyUI :", COMFY)
    print(" Web     : http://127.0.0.1:%d" % PORT)
    print(" LAN     : http://<這台電腦的IPv4>:%d" % PORT)
    print("=" * 62)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
