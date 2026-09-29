# MiniMeet Web v1.10.0 - Cloudflare Pages

Bu klasor MiniMeet web uygulamasinin Cloudflare Pages surumudur. Vercel bagimliligi yoktur.

- Ana sayfa, yonetici ve katilimci arayuzu Cloudflare Pages statik dosyalari olarak yayinlanir.
- `/ders/<KOD>` ve `/admin` Cloudflare `_redirects` ile calisir; sayfa yenilemede 404 olmaz.
- `/api/ice` Cloudflare Pages Function uzerinden STUN/TURN ayarini verir.
- Hesap/lisans/toplanti API istekleri `/api/minimeet` ve `/api/minimeet-guest` Cloudflare proxy'leri uzerinden Supabase Edge Functions'a gider.
- Kamera, mikrofon, ekran paylasimi ve PeerJS medya/sinyalleme mantigi degistirilmedi.
- EXE/DMG tarafiyla ayni toplantı kodu ve PeerJS kimlik formati korunur.

Kurulum icin `CLOUDFLARE-DEPLOY.md` dosyasina bakin.
