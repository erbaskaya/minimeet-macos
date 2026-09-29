# MiniMeet - Cloudflare Workers kurulumu

Bu paket `pages.dev` kullanmaz. Web uygulamasi + API proxy + statik dosyalar tek Cloudflare Worker icinde calisir.

## Cloudflare Dashboard ile GitHub deploy

1. Workers & Pages > Create application.
2. **Import a repository** secin.
3. GitHub reposunu secin.
4. Root directory olarak `cloudflare-worker` secin.
5. Worker adi **minimeeting** olmali. `wrangler.toml` icindeki `name` ile ayni olmasi gerekir.
6. Build command bos kalabilir veya `npm install` kullanilabilir.
7. Deploy command: `npx wrangler deploy`
8. Deploy sonrasi Cloudflare size `https://minimeeting.<hesap-subdomaini>.workers.dev` adresi verir.

Cloudflare Workers Builds, `wrangler.toml` dosyasini okuyup `public/` klasorunu Static Assets olarak Worker ile birlikte yayinlar.

## Supabase Auth

Worker adresi belli olduktan sonra Supabase > Authentication > URL Configuration:

- Site URL: `https://minimeeting.<hesap-subdomaini>.workers.dev`
- Redirect URL: `https://minimeeting.<hesap-subdomaini>.workers.dev/**`

## Windows/Mac MiniMeet

Worker adresi belli olduktan sonra masaustu uygulamasinin yanindaki `minimeet.config.json`:

```json
{
  "webOrigin": "https://minimeeting.<hesap-subdomaini>.workers.dev"
}
```

MiniMeet'i kapatip tekrar acin. Bundan sonra katilimci linkleri Workers adresiyle uretilir.

## TURN (opsiyonel)

TURN sunucusu kullanacaksaniz Worker Settings > Variables and Secrets:

- TURN_URL
- TURN_USERNAME
- TURN_CREDENTIAL

TURN yoksa bunlari eklemek zorunda degilsiniz. STUN otomatik olarak calisir.

## Vercel degiskenleri

Workers tarafina su Vercel degiskenlerini tasimayin:

- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY
- MINIMEET_ADMIN_EMAILS

Public Supabase baglanti bilgileri web kodunda; service role anahtari ise Supabase Edge Functions icinde kalir.
