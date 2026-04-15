"""Download MobileSAM weights on first use."""

import os
import sys
import ssl
import urllib.request

WEIGHTS_URL = "https://raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/weights/mobile_sam.pt"
WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "weights")
WEIGHTS_PATH = os.path.join(WEIGHTS_DIR, "mobile_sam.pt")


def download():
    if os.path.exists(WEIGHTS_PATH):
        print(f"Weights already exist at {WEIGHTS_PATH}")
        return

    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    print(f"Downloading MobileSAM weights to {WEIGHTS_PATH}...")

    def progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            pct = min(100, downloaded * 100 // total_size)
            mb = downloaded / (1024 * 1024)
            total_mb = total_size / (1024 * 1024)
            sys.stdout.write(f"\r  {mb:.1f} / {total_mb:.1f} MB ({pct}%)")
            sys.stdout.flush()

    # Try normal download first; fall back to unverified SSL if certs are missing
    try:
        urllib.request.urlretrieve(WEIGHTS_URL, WEIGHTS_PATH, reporthook=progress)
    except urllib.error.URLError:
        print("\nSSL verification failed, retrying without verification...")
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ctx)
        )
        urllib.request.install_opener(opener)
        urllib.request.urlretrieve(WEIGHTS_URL, WEIGHTS_PATH, reporthook=progress)

    print("\nDone.")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights-dir", default=None, help="Directory to store weights")
    args = parser.parse_args()
    if args.weights_dir:
        WEIGHTS_DIR = args.weights_dir
        WEIGHTS_PATH = os.path.join(WEIGHTS_DIR, "mobile_sam.pt")
    download()
