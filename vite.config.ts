import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Web Serial API는 secure context(localhost 포함)에서만 동작한다.
    // 하드웨어 실연결 단계에서 localhost 그대로 쓰면 된다.
    host: '127.0.0.1',
  },
});
