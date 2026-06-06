"""Channel listing — static catalogue."""
from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["channels"])


@router.get("/channels")
async def get_channels():
    return {
        "fastx": {"name": "HIZLI VE ÖFKELİ 11", "status": "coming_soon"},
        "spiderman": {"name": "SPIDER-MAN: BRAND NEW DAY", "status": "online"},
        "trt1": {"name": "TRT 1", "status": "online"},
        "trthaber": {"name": "TRT HABER", "status": "online"},
        "tv8": {"name": "TV 8", "status": "online"},
        "trtspor": {"name": "TRT SPOR", "status": "checking"},
        "bein1": {"name": "beIN SPORTS 1", "status": "online", "premium": True},
        "bein2": {"name": "beIN SPORTS 2", "status": "maintenance", "premium": True},
        "ssport": {"name": "S SPORT", "status": "maintenance", "premium": True},
        "gstv": {"name": "GS TV", "status": "maintenance"},
        "fbtv": {"name": "FB TV", "status": "maintenance"},
        "atv": {"name": "ATV", "status": "maintenance"},
        "aspor": {"name": "A SPOR", "status": "maintenance"},
    }
