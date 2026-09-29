# MiniMeet Desktop + Cloudflare Web v1.0.0

Bu repo MiniMeet'in Windows/macOS yonetici uygulamasini ve Cloudflare Pages web istemcisini birlikte icerir.

## Desktop

- Windows portable EXE ve macOS DMG kaynaklari repo kokundedir.
- Kamera/mikrofon, arka plan, ekran paylasimi, cizim, zamanlayici ve always-on-top kontroller korunur.
- Windows ana MiniMeet penceresi toplantida da taskbar'da kalir; simge durumundan geri acilabilir.
- Katilimci linki varsayilan olarak `https://minimeeting.pages.dev` uzerinden uretilir.
- Windows'ta Cloudflare adresi degisirse EXE yanindaki `minimeet.config.json` dosyasinda `webOrigin` degerini degistirmeniz yeterlidir.

## Cloudflare Web

Web kodu `cloudflare-web/` klasorundedir. Cloudflare Pages Git entegrasyonunda Root directory olarak `cloudflare-web` secilir. Ayrintilar: `cloudflare-web/CLOUDFLARE-DEPLOY.md`.

## Windows

- `CREATE-PORTABLE-EXE.bat`: Node gerekmeden Electron runtime indirip portable klasor olusturur.
- `BUILD-WINDOWS.bat`: Node/Electron paketleri ile build alir.

## macOS

GitHub Actions workflow'lari korunmustur:
- `Build macOS DMG - Unsigned`
- `Build macOS DMG - Signed and Notarized`
