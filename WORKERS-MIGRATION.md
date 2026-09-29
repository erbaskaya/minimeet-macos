# MiniMeet: Pages -> Workers

Pages paketi artik zorunlu degil. Yeni production web klasoru: `cloudflare-worker/`.

Worker deploy edildikten sonra verilen `workers.dev` adresini:

1. Supabase Auth Site URL / Redirect URL ayarlarina,
2. `minimeet.config.json` icindeki `webOrigin` alanina

yazin.

Masaustu EXE kaynak kodu `webOrigin` degerini config dosyasindan okudugu icin Worker adresi icin EXE'yi tekrar derlemek zorunlu degildir.
