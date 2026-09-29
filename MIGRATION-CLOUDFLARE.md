# MiniMeet - Vercel'den Cloudflare Pages'e gecis

## 1. GitHub

Bu repoyu mevcut GitHub reposunun yeni hali olarak kullanin. Desktop kaynaklari repo kokunde, web projesi `cloudflare-web/` altindadir.

## 2. Cloudflare Pages projesi

Cloudflare Dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git.

- Repository: MiniMeet GitHub reposu
- Production branch: `main`
- Project name: `minimeeting`
- Root directory: `cloudflare-web`
- Framework preset: `None`
- Build command: bos birakin (Cloudflare zorunlu tutarsa `exit 0`)
- Build output directory: `public`

Production adresi hedef olarak `https://minimeeting.pages.dev` olmalidir.

`functions/` klasoru Git entegrasyonuyla Pages Functions olarak deploy edilir. Dashboard Direct Upload ile `functions/` klasoru calismaz; bu nedenle GitHub baglantili Pages kullanin.

## 3. Supabase Auth

Cloudflare canli olduktan sonra Supabase -> Authentication -> URL Configuration:

- Site URL: `https://minimeeting.pages.dev`
- Redirect URLs: `https://minimeeting.pages.dev/**`

## 4. Desktop EXE / DMG

Desktop varsayilan katilimci adresi `https://minimeeting.pages.dev` olarak degistirildi.

Windows portable klasorunde EXE'nin yanindaki `minimeet.config.json`:

```json
{
  "webOrigin": "https://minimeeting.pages.dev"
}
```

Cloudflare proje adresi farkli olursa sadece bu dosyadaki `webOrigin` degerini degistirip MiniMeet'i yeniden acin.

Mac kaynak build'inde `app/app-config.json` ayni adresi tasir.

## 5. TURN (opsiyonel)

TURN kullanilacaksa Cloudflare Pages -> Settings -> Variables and Secrets:

- `TURN_URL`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

TURN yoksa MiniMeet Google STUN ile devam eder.

## 6. Kontrol listesi

- Ana sayfa aciliyor.
- `/admin` yenilenince 404 vermiyor.
- `/ders/ABC123?role=student` yenilenince 404 vermiyor.
- Web -> Web toplantisi calisiyor.
- EXE -> Web katilimci calisiyor.
- Kamera/mikrofon izinleri Cloudflare alan adinda isteniyor.
- Ekran paylasimi ve ekran onizlemesi calisiyor.
- EXE'nin olusturdugu katilimci linki `pages.dev` adresini kullaniyor.
- EXE toplantida Windows taskbar'da gorunuyor ve minimize sonrasi geri aciliyor.
