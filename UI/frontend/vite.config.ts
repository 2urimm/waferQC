import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Web Serial API는 secure context(localhost 포함)에서만 동작한다.
    // 하드웨어 실연결 단계에서 localhost 그대로 쓰면 된다.
    host: '127.0.0.1',
    // ngrok 같은 터널로 외부 공개할 때 Vite의 Host 헤더 검사에 막히지 않게 한다.
    // 로컬 개발에는 영향 없음.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    proxy: {
      /*
       * 모델 서버(127.0.0.1:8077)는 브라우저가 직접 부른다. 외부 터널로 열면
       * 원격 브라우저의 127.0.0.1에는 모델 서버가 없으므로 그대로는 붙지 못한다.
       * 개발 서버가 대신 중계해 주면 터널 하나로 UI와 추론이 같이 동작한다.
       * 화면의 "모델 서버 주소" 칸에 /model 을 넣으면 이 경로를 탄다.
       */
      '/model': {
        target: 'http://127.0.0.1:8077',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/model/, ''),
      },
    },
    watch: {
      /*
       * 모델 패키지는 감시 대상에서 뺀다.
       * 그 안에 파이썬 venv가 통째로 들어 있어서(torch 포함 수만 개 파일) Vite 감시기가
       * 전부 훑다가 .DS_Store에서 EBUSY로 프로세스째 죽는다. 실제로 개발 서버가
       * 두 번 내려간 원인이 이거였다. torch 안의 html 파일 때문에 페이지가 리로드되는
       * 부작용도 같이 없어진다.
       */
      ignored: ['**/wafer_final_package*/**', '**/.venv/**', '**/__pycache__/**'],
    },
  },
});
