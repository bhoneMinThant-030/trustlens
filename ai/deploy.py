"""
Deploy the AI code to the trustlens-ai Lambda function.

Usage (from the repo root):
  python ai/deploy.py                          # upload code and settings
  python ai/deploy.py --smoke "Is there a late payment fee?"   # then ask one test question

Uses ai/.env for settings and your default AWS CLI profile (bhone-admin).
The trustlens-node user cannot deploy; it can only invoke.

What it does:
  1. Zips handler.py, retrieve.py, llm.py, checks.py, approved.py and prompts/.
     No extra packages: boto3 is already part of the Lambda Python runtime.
  2. Uploads the zip to the function.
  3. Sets the handler to handler.lambda_handler, 60 s timeout and 512 MB, and
     copies the settings in ENV_KEYS from ai/.env to the function.
"""
import argparse
import io
import json
import os
import sys
import zipfile
from pathlib import Path

AI_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(AI_DIR))

CODE_FILES = ["handler.py", "retrieve.py", "llm.py", "checks.py", "approved.py"]
REQUIRED_KEYS = ["EMBEDDING_MODEL_ID", "EMBEDDING_DIMENSIONS", "ANSWER_MODEL_ID",
                 "CHECKER_MODEL_ID", "S3_BUCKET", "S3_INDEX_KEY"]
OPTIONAL_KEYS = ["TOP_K", "MIN_SCORE", "MAX_EVIDENCE", "ANSWER_SHOWS_METADATA", "APPROVED_MATCH_MIN",
                 "ALSO_FOUND_MIN"]


def build_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name in CODE_FILES:
            z.write(AI_DIR / name, name)
        for path in sorted((AI_DIR / "prompts").glob("*.txt")):
            z.write(path, f"prompts/{path.name}")
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser(description="Deploy the TrustLens AI code to Lambda.")
    ap.add_argument("--function", default=None, help="function name (default: trustlens-ai)")
    ap.add_argument("--profile", help="AWS CLI profile (default: your default profile)")
    ap.add_argument("--smoke", metavar="QUESTION", help="after deploying, ask this question")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    from dotenv import load_dotenv
    load_dotenv(AI_DIR / ".env")

    missing = [k for k in REQUIRED_KEYS if not os.getenv(k)]
    if missing:
        sys.exit(f"Set these in ai/.env first: {', '.join(missing)}")
    if os.environ["S3_BUCKET"].endswith("change-me"):
        sys.exit("S3_BUCKET in ai/.env is still the placeholder. Put your bucket name in.")

    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError, ProfileNotFound

    function = args.function or os.getenv("LAMBDA_FUNCTION_NAME", "trustlens-ai")
    region = os.getenv("AWS_REGION", "ap-southeast-2")
    try:
        lam = boto3.Session(profile_name=args.profile, region_name=region).client("lambda")

        code = build_zip()
        print(f"Uploading {len(code) / 1024:.0f} KB of code to {function} ({region})...")
        lam.update_function_code(FunctionName=function, ZipFile=code)
        lam.get_waiter("function_updated_v2").wait(FunctionName=function)

        env = lam.get_function_configuration(FunctionName=function).get(
            "Environment", {}).get("Variables", {})
        env.update({k: os.environ[k] for k in REQUIRED_KEYS + OPTIONAL_KEYS if os.getenv(k)})
        print("Updating handler, timeout, memory and settings...")
        lam.update_function_configuration(
            FunctionName=function, Handler="handler.lambda_handler",
            Timeout=60, MemorySize=512, Environment={"Variables": env})
        lam.get_waiter("function_updated_v2").wait(FunctionName=function)
        print(f"Deployed. Settings on the function: {', '.join(sorted(env))}")

        if args.smoke:
            print(f"\nSmoke test: {args.smoke}\n")
            r = lam.invoke(FunctionName=function, Payload=json.dumps(
                {"requestId": "smoke-1", "question": args.smoke}).encode())
            payload = json.loads(r["Payload"].read())
            if r.get("FunctionError"):
                sys.exit(f"The function crashed: {json.dumps(payload, indent=2)}")
            from run_local import print_summary
            print_summary(payload)
            if "error" in payload:
                sys.exit(1)
    except (NoCredentialsError, ProfileNotFound) as e:
        sys.exit(f"AWS credentials problem: {e}. Run: aws configure")
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code == "ResourceNotFoundException":
            sys.exit(f"No function called {function} in {region}. Check the name and AWS_REGION.")
        if code in ("AccessDeniedException", "AccessDenied"):
            sys.exit(f"Access denied. Deploy with the bhone-admin profile, not trustlens-node.\n{e}")
        raise


if __name__ == "__main__":
    main()
