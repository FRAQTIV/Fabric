# DigitalOcean Gradient AI Agents

Fabric can talk to DigitalOcean Gradient™ AI Agents by using DigitalOcean's OpenAI-compatible
inference endpoint. You provide a **model access key** for inference plus an optional **DigitalOcean
API token** for model discovery.

## Prerequisites

1. Create or locate a Gradient AI Agent in the DigitalOcean control panel.
2. Create a **model access key** for inference (this is not the same as your DigitalOcean API token).
3. (Optional) Keep a DigitalOcean API token handy if you want `fabric --listmodels` to query the
   control plane for available models.

The official walkthrough for creating and using agents is here:
<https://docs.digitalocean.com/products/gradient-ai-platform/how-to/use-agents/>

## Environment variables

Set the following environment variables before running `fabric --setup`:

```bash
# Required: model access key for inference
export DIGITALOCEAN_INFERENCE_KEY="your-model-access-key"

# Optional: control-plane token for model listing
export DIGITALOCEAN_TOKEN="your-digitalocean-api-token"

# Optional: override the default inference base URL
export DIGITALOCEAN_INFERENCE_BASE_URL="https://inference.do-ai.run/v1"
```

If you need a region-specific inference URL, you can retrieve it from the GenAI regions API:

```bash
curl -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" \
  "https://api.digitalocean.com/v2/gen-ai/regions"
```

## Fabric setup

Run setup and select the DigitalOcean vendor:

```bash
fabric --setup
```

Then list models (requires `DIGITALOCEAN_TOKEN`) and pick the inference name:

```bash
fabric --listmodels
fabric --vendor DigitalOcean --model <inference_name> --pattern summarize
```

If you skip `DIGITALOCEAN_TOKEN`, you can still use Fabric by supplying the model name directly
based on the agent or model you created in DigitalOcean.
