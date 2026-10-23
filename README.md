# NewMe Smart Home — Open Tools

Open-source toolchain for smart home system design, quotation, and quality assurance.

Part of the NewMe Smart Home ecosystem (Dubai, UAE).

## Tools

| Tool | Description |
|------|-------------|
| `tools/cos_lib.py` | Tencent Cloud COS access library (Python stdlib only) |
| `tools/quotation_verify.py` | Cross-validate device quantities across CAD/PPT/Excel |
| `tools/md5_gate.py` | Floor plan MD5 verification before delivery |
| `tools/gemini_qa.py` | Multi-tier visual QA fallback chain (Gemini → GLM → OCR) |
| `tools/checkpoint.py` | Browser automation checkpoint & resume |

## Quick Start

```bash
# Install (no dependencies beyond Python 3.10+ stdlib)
git clone https://github.com/69755354/newme.git
cd newme

# COS file operations
python3 tools/cos_lib.py list tanya-1420640156
python3 tools/cos_lib.py download tanya-1420640156 path/to/file.pdf

# Verify floor plan
python3 tools/md5_gate.py check template.pptx


# Cross-validate quotation
python3 tools/quotation_verify.py --project "ProjectName" --cad cad_quantities.json --ppt ppt_quantities.json --excel quotation.pdf
```

## Requirements

- Python 3.10+
- COS tools: `coscmd` (for bucket operations)
- Gemini QA: `GEMINI_API_KEY` env var (optional fallback chain)
- Quotation verify: `libreoffice` (for PDF text extraction)


## Skills

[**newme office — 完整双视图办公室**](skills/newme-office/)

Complete modern and pixel offices, animated staff and CEO, live portable tasks, tap/yelp reactions and applause. No GPT account required. [Preview and installation](skills/newme-office/README.md) · [Skill instructions](skills/newme-office/SKILL.md) · [Connect any tool](skills/newme-office/assets/app/INTEGRATION.md).

### Interaction-only component

The following is the smaller standalone interaction module. For the complete office, install **newme-office** above.

[**newme-interactions — 拍一下，叫一声**](skills/newme-interactions/)

A self-contained agent skill with `SKILL.md`, a local installer, and bundled source for microphone impact detection, cartoon whip/yelp reactions and applause. Runs with Node.js 22+ and a browser; no GPT account or model SDK required. [Skill and installation](skills/newme-interactions/README.md) · [Agent instructions](skills/newme-interactions/SKILL.md) · [Integration guide](skills/newme-interactions/assets/app/INTEGRATION.md).

## License

MIT — see [LICENSE](LICENSE).
