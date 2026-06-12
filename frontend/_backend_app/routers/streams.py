"""Generic HLS proxy + stream health (proxy any m3u8 with CORS + segment rewriting)."""
import re
import httpx
from urllib.parse import urlparse, urljoin, quote
from fastapi import APIRouter, HTTPException, Response

from ..core.config import HLS_PROXY_TIMEOUT, ST11_VALIDATE_TIMEOUT

router = APIRouter(prefix="/api", tags=["streams"])


@router.get("/stream/health")
async def check_stream_health(url: str):
    try:
        async with httpx.AsyncClient(timeout=ST11_VALIDATE_TIMEOUT, follow_redirects=True) as http:
            r = await http.head(url, headers={"User-Agent": "Mozilla/5.0"})
            return {"url": url, "status": r.status_code, "ok": r.status_code == 200,
                    "content_type": r.headers.get("content-type", "")}
    except Exception as e:
        return {"url": url, "status": 0, "ok": False, "error": str(e)}


@router.get("/stream/proxy")
async def proxy_stream(url: str, max_level: int = 1080):
    try:
        async with httpx.AsyncClient(timeout=HLS_PROXY_TIMEOUT, follow_redirects=True) as http:
            parsed = urlparse(url)
            domain = f"{parsed.scheme}://{parsed.netloc}"
            base_url = f"{parsed.scheme}://{parsed.netloc}{'/'.join(parsed.path.split('/')[:-1])}/"
            r = await http.get(url, headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "*/*",
                "Origin": domain,
                "Referer": domain + "/",
            })
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="Stream fetch failed")
            lines = r.text.split('\n')
            new_lines, i = [], 0
            while i < len(lines):
                line = lines[i]
                if line.startswith('#EXT-X-STREAM-INF'):
                    res_m = re.search(r'RESOLUTION=\d+x(\d+)', line)
                    if res_m and int(res_m.group(1)) > max_level:
                        i += 2
                        continue
                if line.startswith('#'):
                    if 'URI="' in line:
                        m = re.search(r'URI="([^"]+)"', line)
                        if m:
                            key_url = m.group(1)
                            if not key_url.startswith('http'):
                                key_url = urljoin(base_url, key_url)
                            line = re.sub(r'URI="[^"]+"', f'URI="/api/stream/ts?url={quote(key_url, safe="")}"', line)
                    new_lines.append(line)
                elif line.strip() and not line.startswith('#'):
                    seg_url = line.strip()
                    if not seg_url.startswith('http'):
                        seg_url = urljoin(base_url, seg_url)
                    new_lines.append(f'/api/stream/ts?url={quote(seg_url, safe="")}')
                else:
                    new_lines.append(line)
                i += 1
            return Response(content='\n'.join(new_lines),
                            media_type="application/vnd.apple.mpegurl",
                            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stream/ts")
async def proxy_ts(url: str):
    try:
        async with httpx.AsyncClient(timeout=HLS_PROXY_TIMEOUT, follow_redirects=True) as http:
            r = await http.get(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*"})
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="Segment fetch failed")
            content_type = r.headers.get('content-type', 'video/mp2t')
            if 'mpegurl' in content_type.lower() or url.endswith('.m3u8'):
                parsed = urlparse(url)
                base_url = f"{parsed.scheme}://{parsed.netloc}{'/'.join(parsed.path.split('/')[:-1])}/"
                lines = r.text.split('\n')
                new_lines = []
                for line in lines:
                    if line.startswith('#'):
                        if 'URI="' in line:
                            m = re.search(r'URI="([^"]+)"', line)
                            if m:
                                key_url = m.group(1)
                                if not key_url.startswith('http'):
                                    key_url = urljoin(base_url, key_url)
                                line = re.sub(r'URI="[^"]+"', f'URI="/api/stream/ts?url={quote(key_url, safe="")}"', line)
                        new_lines.append(line)
                    elif line.strip() and not line.startswith('#'):
                        seg_url = line.strip()
                        if not seg_url.startswith('http'):
                            seg_url = urljoin(base_url, seg_url)
                        new_lines.append(f'/api/stream/ts?url={quote(seg_url, safe="")}')
                    else:
                        new_lines.append(line)
                return Response(content='\n'.join(new_lines),
                                media_type="application/vnd.apple.mpegurl",
                                headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"})
            if url.endswith('.ts'):
                content_type = 'video/mp2t'
            elif url.endswith('.key') or 'key' in url.lower():
                content_type = 'application/octet-stream'
            return Response(content=r.content, media_type=content_type,
                            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
