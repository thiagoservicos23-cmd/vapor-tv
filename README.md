# Vapor TV (Tauri)

Front-end em `www/`, backend (proxy local de streams) em `src-tauri/`.

## Desktop
    npm install
    npm run tauri dev

## APK Android (na nuvem, sem instalar nada)
1. Crie um repositorio no GitHub e envie o conteudo desta pasta.
2. Aba **Actions** -> **Build Android APK** -> **Run workflow**.
3. Quando terminar (10-20 min), baixe o artefato **vapor-tv-apk**, extraia e instale o .apk no celular
   (permita "instalar apps desconhecidos").
