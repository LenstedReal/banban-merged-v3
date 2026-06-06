"""beIN 1 stream via ST11 + master manifest helper."""
import httpx
from urllib.parse import quote
from time import time
from fastapi import APIRouter, HTTPException, Response

from ..services.st11 import st11_manager

router = APIRouter(prefix="/api/bein1", tags=["bein"])


@router.get("/health")
async def bein1_health():
    valid = await st11_manager.is_token_valid()
    return {
        "valid": valid,
        "current_tms": st11_manager.current_tms,
        "current_token_preview": (st11_manager.current_token[:8] + "…") if st11_manager.current_token else "",
        "last_refresh_age_seconds": int(time() - st11_manager.last_refresh),
    }


@router.post("/refresh")
async def bein1_refresh():
    ok = await st11_manager.try_auto_refresh()
    return {"refreshed": ok, "tms": st11_manager.current_tms,
            "token_preview": (st11_manager.current_token[:8] + "…") if st11_manager.current_token else ""}


@router.get("/stream.m3u8")
async def bein1_stream():
    try:
        stream_url = await st11_manager.get_stream_url()
        async with httpx.AsyncClient(timeout=15.0) as http:
            r = await http.get(stream_url, headers={
                "User-Agent": "SSUserAgent", "Accept": "*/*",
                "Connection": "keep-alive", "Host": "st11.lol",
            }, follow_redirects=True)
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="beIN 1 unavailable")
            lines = r.text.split('\n')
            new_lines = []
            for line in lines:
                if line.startswith('#'):
                    new_lines.append(line)
                elif line.strip() and not line.startswith('#'):
                    seg_url = line.strip()
                    if not seg_url.startswith('http'):
                        seg_url = (f"https://st23.lol/static/bs111/{seg_url}"
                                   if not seg_url.startswith('/')
                                   else f"https://st23.lol{seg_url}")
                    new_lines.append(f'/api/bein1/seg.ts?url={quote(seg_url, safe="")}')
                else:
                    new_lines.append(line)
            return Response(content='\n'.join(new_lines),
                            media_type="application/vnd.apple.mpegurl",
                            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/seg.ts")
async def bein1_segment(url: str):
    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            r = await http.get(url, headers={
                "User-Agent": "SSUserAgent", "Accept": "*/*",
                "Connection": "keep-alive",
                "Host": "st23.lol" if "st23.lol" in url else "st11.lol",
            }, follow_redirects=True)
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="Segment failed")
            return Response(content=r.content, media_type='video/mp2t',
                            headers={"Access-Control-Allow-Origin": "*",
                                     "Cache-Control": "public, max-age=300"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
