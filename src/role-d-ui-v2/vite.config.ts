import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { resolve } from "node:path"

const orchestratorTarget = "http://127.0.0.1:8787"

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    proxy: {
      "/health": orchestratorTarget,
      "/orchestrator": orchestratorTarget,
    },
  },
  preview: {
    proxy: {
      "/health": orchestratorTarget,
      "/orchestrator": orchestratorTarget,
    },
  },
  build: {
    outDir: resolve(__dirname, "../../dist/role-d-ui-v2"),
    // 本机删除保护 shim 会拦截 vite 的清空操作（环境问题）；产物目录由
    // 构建脚本在 build 前显式清空，这里避免二次清空。
    emptyOutDir: false,
  },
})
