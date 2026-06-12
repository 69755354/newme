     2|# model-switch-cheatsheet.sh — 模型切换速查 (run or source for echo)
     3|# 完整文档: skill_view(name='multi-model-routing')
     4|
     5|cat << 'EOF'
     6|╔══════════════════════════════════════════════════════════════╗
     7|║           NewMe 模型切换速查 v1.0 (2026-06-12)              ║
     8|╠══════════════════════════════════════════════════════════════╣
     9|║                                                              ║
    10|║  正确语法 (用 alias 或 --provider)                           ║
    11|║  ─────────────────────────────────────                       ║
    12|║  /model glm51          → GLM-5.1 Coding Plan (1.1B tokens)  ║
    13|║  /model ds             → DeepSeek V4 Pro                    ║
    14|║  /model opus           → Opus 4.8 (需显式切换, $15/M)       ║
    15|║  /model glm51-coding   → GLM-5.1 Coding Plan (别名)         ║
    16|║  /model glmcoding      → GLM-5.1 Coding Plan (别名)         ║
    17|║                                                              ║
    18|║  或带 --provider:                                            ║
    19|║  /model claude-opus-4-8 --provider opus                      ║
    20|║  /model deepseek-v4-pro --provider deepseek                  ║
    21|║                                                              ║
    22|║  ❌ 错误语法 (常见陷阱)                                      ║
    23|║  ─────────────────────────────────────                       ║
    24|║  /model opus:claude-opus-4-8  → 冒号不是provider分隔符      ║
    25|║  /model opus/claude-opus-4-8  → 斜杠只给OpenRouter用        ║
    26|║  /model gpt-5.5               → 被Codex provider抢走       ║
    27|║                                                              ║
    28|║  诊断命令                                                    ║
    29|║  ─────────────────────────────────────                       ║
    30|║  # 当前配置:                                                 ║
    31|║  grep '^model:\|^  provider:\|^  default:' ~/.newme/config.yaml
    32|║                                                              ║
    33|║  # 实际运行模型 (最权威):                                    ║
    34|║  grep 'provider=' ~/.newme/logs/gateway.log 2>/dev/null | tail -3
    35|║                                                              ║
    36|║  # 最近API调用:                                              ║
    37|║  grep 'API call' ~/.newme/logs/agent.log | tail -3          ║
    38|║                                                              ║
    39|║  三大已知Bug + Workaround                                    ║
    40|║  ─────────────────────────────────────                       ║
    41|║  1. delegate_task忽略model参数 → 先切主session再delegate     ║
    42|║  2. 裸名model走OpenRouter 401 → 用model_aliases配置解决     ║
    43|║  3. 切provider不切base_url   → 三字段原子更新               ║
    44|║     (provider + default + base_url 必须同时改)               ║
    45|║                                                              ║
    46|║  Vision路由                                                  ║
    47|║  ─────────────────────────────────────                       ║
    48|║  Gemini 2.5 Flash → 首选(免费+精确尺寸)                     ║
    49|║  GLM-4.6V Flash  → 免费,CAD初筛/OCR (❌禁用于尺寸判读)      ║
    50|║  Qwen3-VL-235B   → 备用(Gemini限流时)                       ║
    51|║  Fallback链: gemini_qa.py (Gemini→GLM4V→OCR→BLOCK)         ║
    52|║                                                              ║
    53|╚══════════════════════════════════════════════════════════════╝
    54|EOF
    55|