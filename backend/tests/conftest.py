import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ["DEMO_DIR"] = str(Path(__file__).resolve().parent / "no-demo-data")
