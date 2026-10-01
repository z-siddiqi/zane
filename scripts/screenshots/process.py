"""Turn raw simulator captures into README screenshots: half size, rounded corners.

Usage: python3 scripts/screenshots/process.py <raw-dir>
Reads home.png, inbox.png, chat.png and writes them to docs/assets/screenshots/.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

NAMES = ["home", "inbox", "chat"]
SCALE = 0.5
# iPhone screen corners are ~62pt; raw captures are @3x.
CORNER_RADIUS = round(62 * 3 * SCALE)
SUPERSAMPLE = 4

out_dir = Path(__file__).resolve().parents[2] / "docs" / "assets" / "screenshots"
out_dir.mkdir(parents=True, exist_ok=True)

for name in NAMES:
    raw = Image.open(Path(sys.argv[1]) / f"{name}.png").convert("RGB")
    size = (round(raw.width * SCALE), round(raw.height * SCALE))
    image = raw.resize(size, Image.LANCZOS)

    mask = Image.new("L", (size[0] * SUPERSAMPLE, size[1] * SUPERSAMPLE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, mask.width - 1, mask.height - 1], radius=CORNER_RADIUS * SUPERSAMPLE, fill=255
    )
    image.putalpha(mask.resize(size, Image.LANCZOS))

    path = out_dir / f"{name}.png"
    image.save(path, optimize=True)
    print(f"{path.relative_to(out_dir.parents[2])}  {size[0]}x{size[1]}  {path.stat().st_size // 1024} KB")
