import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // ExcelJS: pakai build browser-nya (sudah menyertakan polyfill yang dibutuhkan).
      exceljs: 'exceljs/dist/exceljs.min.js',
    },
  },
  build: {
    // ExcelJS + pembuat dokumen cukup besar; ini hanya batas peringatan ukuran.
    chunkSizeWarningLimit: 1500,
  },
})
