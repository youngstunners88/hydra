---
name: secrets-hygiene
description: Protect seeds, private keys, API keys, and session cookies from logs, envs, prompts, and browser sidecars.
---

# Secrets Hygiene

## Why this rule exists

Hydra can eventually sign transactions. A leaked private key is not a subtle
bug; it is direct, irreversible loss of the hot wallet. Most leaks happen
through ordinary paths:

- A private key is printed in an error trace.
- An `.env` file is copied into a prompt.
- A browser task receives the hot wallet key through environment inheritance.
- A code example commits `PRIVATE_KEY=abc123` instead of `PRIVATE_KEY=REPLACE_ME`.
- Shell history stores a command line with a seed phrase.

Secrets hygiene is the first line of defense because the exploit is often the
operator, not the chain.

## Failure scenarios this prevents

1. **Prompt leak:** The agent runs `print(os.environ)` or outputs config and
   exposes `SOLANA_PRIVATE_KEY` in a transcript.
2. **Sidecar leak:** `services/browser-hunter` is launched with the hot wallet
   env file and a webpage task can read process env.
3. **Repo leak:** `.env` or `hot.env` is committed because it was not in
   `.gitignore`.
4. **Command history leak:** A private key is embedded in a `hydra swap` command,
   shell history, or log file.
5. **Error leak:** A wallet adapter throws and includes the signed transaction or
   key bytes in the exception message.

## Agent must

- Never print a seed phrase, private key, mnemonic, or session cookie.
- Never output `SOLANA_PRIVATE_KEY`, `EVM_PRIVATE_KEY`, `HOT_EXEC_MNEMONIC`, or
  any equivalent secret value.
- Use `REPLACE_ME` in examples, test fixtures, and docs.
- Keep separate env files:
  - `hunt_readonly.env` for the optional hunt wallet.
  - `hot_exec.env` for the live signing wallet.
- Ensure private key files are chmod `0600`.
- Ensure `.env`, `*.env`, and wallet files are gitignored.
- Redact secrets from logs before writing exceptions or hydration output.
- Keep browser sidecar env files separate from the hot wallet env files.
- Reject any browser task or sidecar that imports `EVM_PRIVATE_KEY` or
  `SOLANA_PRIVATE_KEY`.

## Operational checks

Before touching live mode:

1. Confirm `hot_exec.env` is excluded from git:

   ```text
   git check-ignore hot_exec.env
   ```

2. Confirm permissions:

   ```text
   chmod 600 hot_exec.env
   chmod 600 data/hot-wallets/*.json
   ```

3. Scan the intended command or prompt for these forbidden patterns:

   ```text
   PRIVATE_KEY
   MNEMONIC
   SEED_PHRASE
   SECRET_KEY
   SESSION_COOKIE
   ```

4. If an example requires a key, use `REPLACE_ME` and leave a comment that no
   real key may be placed here.

5. If a browser sidecar environment is built, source it from a file containing
   only browser credentials and target URLs, never hot wallet keys.

## Specific Hydra constraint

The hunt plane can be read-only. A hunt read-only key cannot sign and should not
be given signer permissions. Even if the key is exposed, the blast radius is
limited. The hot exec key is the only live signer and must be isolated in the
exec plane environment only.
