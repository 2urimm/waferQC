import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Web Serial API는 secure context(localhost 포함)에서만 동작한다.
    // 하드웨어 실연결 단계에서 localhost 그대로 쓰면 된다.
    host: '127.0.0.1',
    watch: {
      /*
       * 모델 패키지(backend/)는 감시 대상에서 뺀다.
       * 그 안에 파이썬 venv가 통째로 들어 있어서(torch 포함 수만 개 파일) Vite 감시기가
       * 전부 훑다가 .DS_Store에서 EBUSY로 프로세스째 죽는다. 실제로 개발 서버가
       * 두 번 내려간 원인이 이거였다. torch 안의 html 파일 때문에 페이지가 리로드되는
       * 부작용도 같이 없어진다.
       */
      ignored: ['**/backend/**', '**/.venv/**', '**/__pycache__/**'],
    },
  },
});
