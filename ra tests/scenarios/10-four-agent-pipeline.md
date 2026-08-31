# Plan, implement, review, and critique

Scenario: `10-four-agent-pipeline`.

Run the installed executable through the terminal acceptance driver:

```sh
sandbox-exec -f /private/tmp/ra-user-sandbox/policy.sb \
  python3 /private/tmp/ra-user-sandbox/terminal_acceptance.py --only 10-four-agent-pipeline
```

The driver creates a fresh isolated project and HOME, records terminal commands and output, and asserts the relevant behavior. See `../terminal_acceptance.py` for the exact user prompts and independent checks, and `../evidence/final/10-four-agent-pipeline.json` for the final transcript. Export the cloud key privately when the case requires it. No repository test script or internal RA module is called.
