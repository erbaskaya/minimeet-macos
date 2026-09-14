# MiniMeet Manager - macOS DMG derleme

Bu paket Windows MiniMeet Yönetici uygulamasının macOS masaüstü derlemesini üretmek için hazırlanmıştır.

## 1. Hemen test etmek için imzasız DMG

Projeyi bir GitHub deposunun kök dizinine yükleyin.

GitHub > Actions > **Build macOS DMG - Unsigned** > **Run workflow**.

İşlem bittiğinde sayfanın altındaki **Artifacts** bölümünden `MiniMeet-Manager-macOS-Unsigned` dosyasını indirin. ZIP'in içinde Universal `.dmg` bulunur. Universal paket Apple Silicon ve Intel Mac'lerde çalışır.

İmzasız test paketinde macOS Gatekeeper uyarısı gösterebilir. Bu normaldir. Dağıtım için aşağıdaki imzalı/notarized sürümü kullanın.

## 2. Drive üzerinden normal dağıtım için imzalı + notarized DMG

Apple Developer hesabından **Developer ID Application** sertifikası gerekir. Sertifikayı `.p12` olarak dışa aktarın ve GitHub repository > Settings > Secrets and variables > Actions alanına şu secret'ları ekleyin:

- `MAC_CSC_LINK`: `.p12` sertifikasının base64 içeriği
- `MAC_CSC_KEY_PASSWORD`: `.p12` dışa aktarırken verdiğiniz parola
- `APPLE_ID`: Apple Developer hesabının e-posta adresi
- `APPLE_APP_SPECIFIC_PASSWORD`: Apple hesabından oluşturulan uygulamaya özel parola
- `APPLE_TEAM_ID`: Apple Developer Team ID

Sonra GitHub > Actions > **Build macOS DMG - Signed and Notarized** > **Run workflow**.

Oluşan `MiniMeet-Manager-macOS-Signed` artifact'ını indirin. İçindeki `.dmg` Google Drive, kendi siteniz veya başka bir doğrudan indirme kanalı üzerinden dağıtılabilir.

## macOS izinleri

MiniMeet ilk çalıştırmada kamera ve mikrofon için macOS sistem izinlerini ister. Ekran paylaşımı ilk kez kullanıldığında macOS ayrıca Ekran Kaydı / Screen Recording izni ister. İzin değiştirildikten sonra uygulamayı kapatıp tekrar açmak gerekebilir.

## Notlar

- Uygulama Mac App Store için yapılandırılmamıştır.
- Bundle ID: `com.baskaya.minimeet.manager`
- Çıktı: Universal DMG (Apple Silicon + Intel)
- macOS minimum hedef: 11.0
- Windows sürümündeki always-on-top kamera paneli, yüzen kontrol çubuğu ve toplantı özellikleri korunmuştur.
- macOS ekran paylaşımında sistem sesi Windows'taki loopback yöntemiyle otomatik eklenmez; mevcut sürüm ekran görüntüsünü paylaşır.
