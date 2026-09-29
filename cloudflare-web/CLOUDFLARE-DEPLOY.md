# MiniMeet Web -> Cloudflare Pages

Bu klasor Vercel gerektirmez. MiniMeet web arayuzu Cloudflare Pages uzerinde calisir. `/api/ice`, `/api/minimeet` ve `/api/minimeet-guest` Cloudflare Pages Functions'tir. Hesap/lisans verileri Supabase'de, WebRTC medya/sinyalleme PeerJS'te kalir. Video trafigi Cloudflare uzerinden tasinmaz.

## GitHub ile Cloudflare Pages

1. Cloudflare Dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git.
2. Bu GitHub reposunu secin.
3. Project name: `minimeeting`
4. Production branch: `main`
5. Root directory: `cloudflare-web`
6. Framework preset: `None`
7. Build command: bos birakin
8. Build output directory: `public`
9. Deploy edin.

Hedef production adresi: `https://minimeeting.pages.dev`

## TURN (istege bagli)

Cloudflare Pages -> Settings -> Variables and Secrets altina gerekirse sunlari ekleyin:

- `TURN_URL` (birden fazla URL virgul ile ayrilabilir)
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

TURN yoksa sistem Google STUN ile devam eder.

## Supabase Auth redirect

Cloudflare deploy'dan sonra Supabase -> Authentication -> URL Configuration:

- Site URL: `https://minimeeting.pages.dev`
- Redirect URLs: `https://minimeeting.pages.dev/**`

Gecis tamamlanana kadar eski Vercel redirect adresini silmek zorunda degilsiniz.
