# MiniMeet Yönetici v0.6

Bu sürüm Katılımcı ekran paylaşımı iznini ekler.

- Yönetici, yüzen kontrol çubuğundaki Ayarlar bölümünden “Katılımcı ekran paylaşabilir” iznini açıp kapatabilir.
- İzin varsayılan olarak kapalıdır.
- Aynı anda yalnızca Yönetici veya Katılımcı ekran paylaşabilir.
- Katılımcı paylaşırken Yönetici paylaşım düğmesi kilitlenir.
- Yönetici izni kapatırsa Katılımcının paylaşımı durdurulur.
- Katılımcı ekran paylaştığında Yönetici penceresi otomatik büyüyerek ekranı gösterir; paylaşım bitince küçük always-on-top kamera paneline döner.
- Süre sayacı, TURN/STUN, otomatik yeniden bağlantı, cihaz seçimi, çizim ve always-on-top kontroller korunur.


## v0.6
- Başlangıç/ayar penceresi büyütüldü (uygun ekranda yaklaşık 1120×900).
- Yönetici adı, süre, bağlantı, aygıtlar ve başlatma düğmesi mümkün olduğunca kaydırmadan görünür.
- Küçük ekranlarda pencere çalışma alanına otomatik sığar.
- Toplantı başlayınca önceki küçük always-on-top kamera paneli davranışı korunur.

## v0.7 - Kamera arka planı
- Normal kamera
- Orta seviye arka plan bulanıklığı
- Özel arka plan resmi seçimi
- Seçim sonraki açılışta hatırlanır
- Toplantı sırasında Ayarlar bölümünden değiştirilebilir

## v0.8.0
- Arka plan maskeleme canvas compositing duzeltildi.
- Bulanik (Orta) ve Arka Plan Resmi efektleri gercek kamera track'ine uygulanir.

## v0.9.1 - macOS DMG desteği
- macOS Universal DMG derleme yapılandırması eklendi (Apple Silicon + Intel).
- GitHub Actions ile Mac sahibi olmadan DMG üretilebilir.
- Kamera ve mikrofon izinleri macOS sistem izni üzerinden ilk açılışta istenir.
- Ekran paylaşımı için macOS Screen Recording açıklaması eklendi.
- İmzasız test DMG ve Developer ID + notarization kullanan dağıtım DMG iş akışları ayrıldı.
