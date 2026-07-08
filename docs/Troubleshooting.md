# 🐛 Troubleshooting

This page covers common issues you may encounter while developing with Transcenda Hotels and how to resolve them.

---

## 🔌 Port Conflicts

### Symptom
```
Error: listen EADDRINUSE :::5000
```
or Docker logs show:
```
port is already allocated
```

### Cause
Another process is already using port `3000` (frontend) or `5000` (backend).

### Fix

**On Windows (PowerShell):**
```powershell
# Find what's using port 5000
netstat -ano | findstr :5000

# Kill the process (replace PID with the actual process ID)
taskkill /PID 1234 /F
```

**On macOS/Linux:**
```bash
# Find what's using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>
```

**Or change the port mapping in `docker-compose.yaml`:**
```yaml
ports:
  - "5001:5000"   # Maps container port 5000 to host port 5001
```

---

## 📦 node_modules Corruption

### Symptom
```
Module not found: Can't resolve 'some-package'
```
or cryptic errors about missing dependencies.

### Cause
- Local `node_modules` conflicting with container `node_modules`
- Incomplete `npm install` due to network issues
- Platform-specific binaries (e.g., esbuild) compiled for wrong OS

### Fix

**Option 1: Rebuild containers (recommended)**
```bash
docker compose down -v    # Remove containers + anonymous volumes
docker compose up --build # Fresh install inside containers
```

**Option 2: Clean up inside the container**
```bash
docker compose exec backend sh
rm -rf node_modules
npm ci
exit
```

**Option 3: If you accidentally installed packages locally**
```bash
# Remove local node_modules (they're not used by Docker anyway)
rm -rf server/node_modules client/node_modules
docker compose up --build
```

> 💡 **Remember:** The anonymous volume `/app/node_modules` in `docker-compose.yaml` prevents your local `node_modules` from leaking into the container. If you're seeing OS-specific errors, this volume is doing its job — just rebuild.

---

## 🚫 Permission Denied

### Symptom
```
EACCES: permission denied, open '/app/...'
```
or
```
Error: Cannot write to /app/node_modules/.cache
```

### Cause
Files created inside the container are owned by `root` or the wrong user, conflicting with the `node` user.

### Fix

**Rebuild with clean permissions:**
```bash
docker compose down
docker compose up --build
```

**If that doesn't work, check file ownership:**
```bash
# On the host, check if files are owned by root
ls -la server/

# If so, fix ownership (replace 1000 with your host user ID)
sudo chown -R 1000:1000 server/ client/
```

**Or manually fix inside the container:**
```bash
docker compose exec backend sh
# Inside the container as root (if needed)
chown -R node:node /app
exit
```

> 💡 Both Dockerfiles include `RUN chown -R node:node /app` and `USER node` to prevent permission issues. If you're seeing this error, the build may have failed before reaching those steps.

---

## 🏗️ Docker Build Failures

### Symptom
```
ERROR: failed to solve: process "/bin/sh -c npm ci" did not complete successfully
```
or
```
npm ERR! code EINTEGRITY
```

### Cause
- Network issues during `npm ci`
- Mismatched `package-lock.json` and `package.json`
- Missing `allowScripts` configuration for esbuild

### Fix

**1. Check the lockfile is in sync:**
```bash
# Regenerate lockfile
docker compose exec backend npm install --package-lock-only
```

**2. Verify allowScripts in `server/package.json`:**
```json
"allowScripts": {
  "esbuild@0.28.1": true
}
```
This is required for tsx's esbuild dependency to install its native binary.

**3. Retry with a clean build:**
```bash
docker compose down -v
docker compose up --build --no-cache
```

**4. If network issues persist, try using a different DNS:**
```bash
# In docker-compose.yaml, add DNS settings
services:
  backend:
    dns:
      - 8.8.8.8
      - 8.8.4.4
```

---

## 🔄 Hot Reload Not Working

### Symptom
- Changes to source files don't appear in the browser
- Backend doesn't restart after saving a file

### Cause
- Bind mount not working correctly
- File watcher limitations on Windows (WSL)
- Docker Desktop file sharing issues

### Fix

**1. Verify bind mounts are working:**
```bash
# Check if files are synced
docker compose exec backend sh -c "ls -la /app/src/"
# Should show your local files
```

**2. Restart Docker Desktop:**
Sometimes Docker Desktop's file watcher gets stuck. Restarting it often fixes the issue.

**3. Enable WSL2 file sharing (Windows):**
- Ensure your project is on the WSL2 filesystem (not a Windows drive)
- Or enable file sharing in Docker Desktop: **Settings → Resources → File Sharing**

**4. Force a restart:**
```bash
docker compose restart backend
docker compose restart frontend
```

---

## 🐳 Docker Desktop Issues

### Symptom
```
docker: command not found
```
or
```
Cannot connect to the Docker daemon
```

### Fix

**1. Ensure Docker Desktop is running:**
- Windows: Look for the Docker whale icon in the system tray
- macOS: Check the menu bar for the Docker icon
- If not running, start Docker Desktop from the Start Menu / Applications

**2. Check Docker is installed:**
```bash
docker --version
docker compose version
```

**3. Restart Docker Desktop:**
Sometimes a simple restart resolves daemon connection issues.

---

## 🌐 Backend Won't Start

### Symptom
```
Error: Cannot find module 'dotenv/config'
```
or
```
TypeError: app.use is not a function
```

### Cause
- Missing dependencies
- Incorrect Node.js version
- Express 5 API changes

### Fix

**1. Ensure dependencies are installed:**
```bash
docker compose exec backend npm ci
```

**2. Check the Node.js version:**
```bash
docker compose exec backend node --version
# Should be v20.x
```

**3. Verify Express 5 imports:**
Express 5 has some API differences from Express 4. If you're migrating, check the [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5.html).

---

## 📋 Quick Reference

| Issue | Quick Fix |
|-------|-----------|
| Port in use | `netstat -ano \| findstr :PORT` → `taskkill /PID <PID> /F` |
| Corrupted node_modules | `docker compose down -v && docker compose up --build` |
| Permission denied | `docker compose up --build` (rebuilds with correct permissions) |
| Build failure | `docker compose down -v && docker compose up --build --no-cache` |
| Hot reload broken | Restart Docker Desktop |
| Backend won't start | `docker compose exec backend npm ci` |

---

> 💡 **Still stuck?** Check the [Getting Started](Getting-Started) guide to ensure you've completed all setup steps, or open a GitHub issue.