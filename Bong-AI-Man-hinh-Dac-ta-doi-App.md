# Bống AI — Đặc tả kỹ thuật màn hình & cảm ứng (đội App)

*Phiên bản kịch bản JSON: **version 2**. Tài liệu này thay thế cách hiểu file kịch bản hiện tại. File cũ (không có trường `version`) vẫn phải chạy được theo luật cũ — xem mục 8.*

---

## 1. Vì sao đổi

Thiết bị nay có **màn hình tròn 360×360 có cảm ứng**. Điều đó thêm hai thứ vào hệ:

- **Kênh phát thứ hai**: hình ảnh/GIF chạy song song với audio, bổ trợ lẫn nhau (nghe từ APPLE đồng thời nhìn thấy quả táo).
- **Kênh phản hồi thứ hai**: trẻ trả lời bằng cách chạm/vuốt màn hình thay vì nói.

Kèm một ràng buộc phần cứng: **tại một thời điểm chỉ phát được ĐÚNG MỘT file audio**. Không còn chồng nhiều lớp âm thanh như hiện nay.

## 2. Thay đổi cấu trúc: từ "mảng node phẳng" sang "danh sách index, mỗi index hai mảng"

**Mô hình hiện tại:** một mảng `nodes[]` phẳng. Nhiều node có thể trùng `order` — chúng là các lớp âm thanh phát chồng lên nhau, mỗi lớp bắt đầu tại **mốc thời gian tuyệt đối** `delayMs` tính từ đầu lượt.

**Mô hình mới:** một danh sách `indexes[]`. Mỗi index là **một lượt phát**, gồm đúng hai mảng chạy song song:

| Mảng | Chứa | Đặc điểm |
|---|---|---|
| `audio` | node loại voice / sfx / amb / music | Các node phát **nối tiếp nhau**, không bao giờ chồng nhau |
| `visual` | node loại image / video | Các node phát **nối tiếp nhau** trên màn hình |

Trong mỗi mảng, node phát lần lượt từ đầu đến cuối. Trường `waitMs` của một node là **khoảng chờ SAU KHI node liền trước trong cùng mảng kết thúc**, không còn là mốc tuyệt đối tính từ đầu lượt.

> **Điểm bắt buộc phải đọc kỹ:** `delayMs` cũ (mốc tuyệt đối) và `waitMs` mới (khoảng chờ nối tiếp) là hai ngữ nghĩa khác nhau trên cùng một con số. Đây là lý do phải có trường `version`.

Vì sao đổi: mô hình mốc tuyệt đối buộc người viết kịch bản phải biết trước độ dài từng file. Mỗi lần tạo lại giọng đọc, độ dài file đổi vài trăm mili giây và toàn bộ lịch trình lệch âm thầm mà không ai biết. Mô hình nối tiếp miễn nhiễm với việc đó.

## 3. Schema JSON version 2

```json
{
  "version": 2,
  "page": "Unit-01-Day-03",
  "indexes": [
    {
      "order": "12",
      "audio": [
        {
          "fileName": "B3_12",
          "nodeType": "voice",
          "scopeType": "day",
          "voice": "Bống",
          "url": "https://.../OT2/{voiceID}/B3_12.mp3",
          "waitMs": 0,
          "durationMs": "full",
          "repeat": 1,
          "volume": 80
        },
        {
          "fileName": "B3_13",
          "nodeType": "voice",
          "scopeType": "day",
          "voice": "Bống",
          "url": "https://.../OT2/{voiceID}/B3_13.mp3",
          "waitMs": 800,
          "durationMs": "full",
          "repeat": 1,
          "volume": 80
        }
      ],
      "visual": [
        {
          "fileName": "IMG_hang_toi",
          "nodeType": "image",
          "scopeType": "day",
          "url": "https://.../OT1/IMG_hang_toi.png",
          "waitMs": 0,
          "durationMs": "full",
          "repeat": 1,
          "stop": "giu"
        }
      ],
      "next": "13"
    }
  ]
}
```

### 3.1 Trường của một index

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `order` | string | Mã index, ví dụ `"12"`; nhánh là `"12.1"`, `"12.2"` |
| `audio` | array | Mảng node âm thanh, **có thể rỗng** |
| `visual` | array | Mảng node hình, **có thể rỗng** |
| `next` | string \| absent | Index kế tiếp. Vắng mặt = hết kịch bản |
| `branches` | array | Chỉ có ở index chứa điểm hỏi. Mỗi phần tử là **một index đầy đủ**, thêm trường `branchType` |
| `branchType` | string | Chỉ có ở index nằm trong `branches[]`: tên nhánh dẫn tới nó |
| `save` | object | Tuỳ chọn: `{category, key, value}` — ghi dữ liệu khi index này chạy |
| `type` | string | Chỉ ở index kiểu `"đọc giá trị đã lưu"` (xem 5.4) |
| `recall` | object | Đi kèm `type` trên: `{category, key, values_from?}` |

### 3.2 Trường của một node

| Trường | Áp dụng | Ý nghĩa |
|---|---|---|
| `fileName` | cả hai | Tên file (để đối chiếu/log) |
| `nodeType` | cả hai | `voice` / `sfx` / `amb` / `music` / `image` / `video` — **đây là thứ quyết định node thuộc mảng nào** |
| `scopeType` | cả hai | `vocative` / `roadmap` / `unit` / `day` (thông tin, không ảnh hưởng runtime) |
| `voice` | audio | Tên giọng (thông tin) |
| `url` | cả hai | URL đầy đủ; còn placeholder `{userPhone}`, `{voiceID}`, `{value}` — app thay như hiện nay |
| `waitMs` | cả hai | **Chờ bao nhiêu mili giây sau khi node trước trong CÙNG mảng kết thúc** rồi mới phát node này |
| `durationMs` | cả hai | Số = cắt sau N mili giây · `"full"` = phát hết file (với `image` thì `"full"` nghĩa là **vô hạn**) |
| `repeat` | cả hai | Số nguyên = phát bấy nhiêu lần · `"loop"` = lặp mãi (**chỉ mảng visual, chỉ node cuối**) |
| `volume` | audio | 0–100 |
| `stop` | visual | `"giu"` = giữ nguyên frame cuối sau khi node kết thúc · `"tat"` = tắt màn hình (đen) |
| `type` | audio | Chỉ có ở node là điểm hỏi (xem mục 5) |
| `brain` / `answer` / `touch` | audio | Cấu hình của điểm hỏi, đi kèm `type` |

**Lưu ý đổi tên:** trường `audio` của node cũ (chứa URL) nay tên là `url`, vì `audio` đã thành tên mảng. Trường `delayMs` thành `waitMs` để nhắc rằng ngữ nghĩa đã đổi.

## 4. Luật chạy

### 4.1 Trong một mảng

1. Node đầu tiên: chờ `waitMs` rồi phát.
2. Node kết thúc khi: phát hết file (`durationMs: "full"`) hoặc đủ `durationMs` mili giây — nhân với số lần `repeat`.
3. Node kế tiếp: chờ `waitMs` của chính nó tính **từ lúc node trước kết thúc**, rồi phát.
4. Hết node cuối → **mảng đó xong**.

Trong lúc chờ (`waitMs`) của một node hình, màn hình hiển thị theo `stop` của node hình liền trước: `giu` thì vẫn thấy frame cuối, `tat` thì màn đen.

### 4.2 Kết thúc một index

**Index kết thúc khi CẢ HAI mảng đều xong.** Node vô hạn (repeat `"loop"`, hoặc `image` với `durationMs: "full"`) được coi là "xong ngay khi bắt đầu" về mặt luồng — nó tiếp tục hiển thị/lặp nhưng **không giữ index lại**.

Kịch bản đã được kiểm tra ở khâu xuất file để bảo đảm:
- Mảng `audio` **không bao giờ** có node `"loop"` — audio luôn hữu hạn.
- Node vô hạn nếu có thì chỉ nằm ở **node cuối** mảng `visual`.
- Không bao giờ có index mà cả hai mảng cùng vô hạn (hoặc một mảng vô hạn còn mảng kia rỗng).

Nghĩa là app luôn có ít nhất một mảng hữu hạn làm đồng hồ. Trường hợp phổ biến nhất: **audio dài 1 phút, hình là GIF 5 giây lặp mãi** → index kết thúc khi audio hết.

### 4.3 Hết index → MÀN ĐEN

**Khi một index kết thúc, màn hình trở về đen.** `stop: "giu"` chỉ có hiệu lực **trong phạm vi index đó** (giữ frame trong lúc chờ node hình kế tiếp, hoặc trong lúc mảng audio còn đang chạy / đang chờ bé phản hồi).

**Index có mảng `visual` rỗng → màn hình đen suốt index đó.** Không có chuyện thừa kế hình từ index trước.

> **Tối ưu bắt buộc:** nếu index kế tiếp có node hình bắt đầu ngay (`waitMs: 0`), app phải **chuyển thẳng sang hình mới, không chớp đen**. Chỉ hiện đen khi thực sự không có gì để hiển thị.

### 4.4 Chuyển index

Index không có điểm hỏi: chạy xong → đi theo `next`. Không có `next` → hết kịch bản.
Index có điểm hỏi: xem mục 5.

## 5. Điểm hỏi

**Điểm hỏi là một node trong mảng `audio`** (vì luôn phải có lời ra đề cho bé — trẻ 4–6 tuổi chưa đọc được chữ, không có câu "con bấm vào con vật màu đỏ nhé" thì bé không biết làm gì).

Luồng: mảng audio chạy tới node có trường `type` → phát audio của node đó → **mở cửa sổ chờ phản hồi** → nhận kết quả → tìm phần tử trong `branches[]` có `branchType` khớp → **nhảy sang index đó ngay lập tức**.

> **Các node audio đứng SAU node hỏi trong cùng mảng sẽ KHÔNG được phát.** Nhận phản hồi xong là nhảy nhánh ngay. (Đây là lý do kịch bản nên đặt node hỏi ở cuối mảng audio; nếu không, khâu xuất file có cảnh báo.)

Trong lúc chờ phản hồi, index chưa kết thúc → hình vẫn hiển thị theo `stop` của node hình cuối.

### 5.1 Chờ phản hồi bằng tiếng — `"câu hỏi 1"` / `"câu hỏi 2"` / `"câu hỏi 3"`

Giữ nguyên như hiện nay (`answer` cho câu hỏi 2, `brain` cho câu hỏi 3, gọi LLM phân loại). Cửa sổ nghe ~5 giây. **Vòng chờ màu ĐỎ.**

### 5.2 Chờ phản hồi bằng cảm ứng — `"câu hỏi chạm"` (MỚI)

```json
{
  "fileName": "B3_30",
  "nodeType": "voice",
  "url": "https://.../B3_30.mp3",
  "waitMs": 0, "durationMs": "full", "repeat": 1, "volume": 80,
  "type": "câu hỏi chạm",
  "touch": { "layout": "tap4", "timeoutMs": 10000 }
}
```

`layout` nhận đúng một trong: `tap2_tren_duoi`, `tap2_trai_phai`, `tap3`, `tap4`, `tap5`, `tap6`, `swipe`.
`timeoutMs` mặc định **10000** (dài hơn cửa sổ nghe vì bé phải nhìn hình, nghĩ, rồi mới đưa tay).

**Không gọi LLM.** App tự tính vùng/hướng rồi khớp thẳng với `branchType`:

| Kết quả | `branchType` |
|---|---|
| Chạm trúng vùng | `zone1` … `zone6` |
| Vuốt đúng hướng | `vuot_len` / `vuot_xuong` / `vuot_trai` / `vuot_phai` |
| Chạm/vuốt nhưng không khớp (vùng chết, ngoài vòng tròn, vuốt không rõ trục) | `cham_khac` |
| Hết 10 giây không thao tác | `silent` |

Hai nhánh `cham_khac` và `silent` **luôn tồn tại** trong mọi câu hỏi chạm (đã kiểm tra ở khâu xuất file), nên app luôn có đường đi.

**Toàn bộ đặc tả hình học, ngưỡng vuốt, vùng chết, quy ước đánh số vùng: xem file `Bong-AI-Layout-cam-ung.html`** — kèm hình vẽ cho cả 7 layout.

### 5.3 Vòng chờ phản hồi (tầng firmware)

Khi mở cửa sổ chờ, vẽ một vòng tròn sát mép màn hình, dày ~10px, **đè lên hình đang hiển thị, không xoá hình**:

- **ĐỎ** = đang chờ bé nói.
- **XANH LÁ** = đang chờ bé chạm/vuốt.

Phần diện tích nằm dưới vòng vẫn tính là vùng bên dưới nó khi bé bấm trúng. Vòng này do firmware tự vẽ cho mọi điểm hỏi — kịch bản không khai báo gì.

### 5.4 `"đọc giá trị đã lưu"` — thuộc INDEX, không thuộc node

Loại này không phát gì và không chờ gì: app tra giá trị đã lưu rồi rẽ nhánh ngay. Vì vậy nó nằm ở **cấp index**, và **index kiểu này được phép rỗng cả hai mảng**:

```json
{
  "order": "20",
  "type": "đọc giá trị đã lưu",
  "recall": { "category": "user", "key": "so_thich_mau", "values_from": "mau_sac" },
  "audio": [], "visual": [],
  "branches": [ ... ]
}
```

Luật: **trước khi phát một index, kiểm tra `index.type`** — nếu là `"đọc giá trị đã lưu"` thì tra cứu và nhảy nhánh luôn, không phát gì.

## 6. Ví dụ đầy đủ — index có câu hỏi chạm và các nhánh

```json
{
  "order": "30",
  "audio": [
    {
      "fileName": "B3_29", "nodeType": "voice", "scopeType": "day", "voice": "Bống",
      "url": "https://.../OT2/{voiceID}/B3_29.mp3",
      "waitMs": 0, "durationMs": "full", "repeat": 1, "volume": 80
    },
    {
      "fileName": "B3_30", "nodeType": "voice", "scopeType": "day", "voice": "Bống",
      "url": "https://.../OT2/{voiceID}/B3_30.mp3",
      "waitMs": 300, "durationMs": "full", "repeat": 1, "volume": 80,
      "type": "câu hỏi chạm",
      "touch": { "layout": "tap4", "timeoutMs": 10000 }
    }
  ],
  "visual": [
    {
      "fileName": "IMG_4convat", "nodeType": "image", "scopeType": "day",
      "url": "https://.../OT1/IMG_4convat.png",
      "waitMs": 0, "durationMs": "full", "repeat": 1, "stop": "giu"
    }
  ],
  "branches": [
    {
      "order": "30.1", "branchType": "zone1",
      "audio": [ { "fileName": "B3_30_1", "nodeType": "voice", "voice": "Bống",
                   "url": "https://.../OT2/{voiceID}/B3_30_1.mp3",
                   "waitMs": 0, "durationMs": "full", "repeat": 1, "volume": 80 } ],
      "visual": [ { "fileName": "GIF_dung", "nodeType": "video",
                    "url": "https://.../OT1/GIF_dung.gif",
                    "waitMs": 0, "durationMs": "full", "repeat": "loop", "stop": "giu" } ],
      "save": { "category": "user", "key": "tu_moi", "value": "cat" },
      "next": "31"
    },
    {
      "order": "30.2", "branchType": "cham_khac",
      "audio": [ { "fileName": "B3_30_2", "nodeType": "voice", "voice": "Bống",
                   "url": "https://.../OT2/{voiceID}/B3_30_2.mp3",
                   "waitMs": 0, "durationMs": "full", "repeat": 1, "volume": 80 } ],
      "visual": [],
      "next": "31"
    },
    {
      "order": "30.3", "branchType": "silent",
      "audio": [ { "fileName": "B3_30_3", "nodeType": "voice", "voice": "Bống",
                   "url": "https://.../OT2/{voiceID}/B3_30_3.mp3",
                   "waitMs": 0, "durationMs": "full", "repeat": 1, "volume": 80 } ],
      "visual": [],
      "next": "31"
    }
  ]
}
```

**Diễn giải:** ảnh 4 con vật hiện ngay từ đầu và giữ nguyên suốt index (kể cả lúc chờ bé bấm, vì `stop: "giu"`). Audio phát câu dẫn, chờ 300ms, phát câu hỏi rồi mở cửa sổ chạm 10 giây với lưới 4 vùng, vòng xanh lá hiện lên. Bé bấm vùng trên → nhánh `zone1`: ghi dữ liệu, phát lời khen kèm GIF lặp mãi (index này kết thúc khi audio khen hết, GIF bị cắt tại đó, màn về đen), rồi sang index 31. Bé bấm vào vùng chết ở tâm → `cham_khac`, mảng hình rỗng nên màn đen. Bé không làm gì trong 10 giây → `silent`.

## 7. Những gì hết hiệu lực

- **Node trùng `order` để chồng lớp âm thanh** — không còn. Một thời điểm một audio.
- **`delayMs` là mốc tuyệt đối** — thay bằng `waitMs` là khoảng chờ nối tiếp.
- **`No Next`** — luồng nay ở cấp index, cột đó chuyển sang mang nghĩa `repeat`.
- **`type: "dẫn truyện"`** — node nội dung không cần nhãn loại nữa, `nodeType` đã đủ. `type` chỉ còn xuất hiện ở điểm hỏi.
- **Nhạc nền chạy dưới lời thoại** — không còn khả thi ở tầng phát. Nhạc nền phải được trộn sẵn vào file lúc sản xuất, hoặc chỉ nằm ở khoảng lặng giữa các lời thoại.

## 8. Tương thích ngược

File kịch bản **không có trường `version`** = định dạng cũ, phải chạy theo luật cũ (mảng `nodes` phẳng, `delayMs` là mốc tuyệt đối, chồng lớp âm thanh). File **có `"version": 2`** chạy theo tài liệu này. Không được suy diễn định dạng từ việc có hay không có mảng `visual` — phải đọc `version`.

## 9. Nghiệm thu

1. Index chỉ có audio → chạy đúng thứ tự, `waitMs` tính từ lúc node trước kết thúc; màn hình đen suốt.
2. Index audio dài + GIF `loop` ngắn → GIF lặp liên tục, index kết thúc đúng lúc audio hết, màn về đen.
3. Index audio dài + ảnh tĩnh `stop: giu` → ảnh giữ nguyên tới hết index.
4. Index chỉ có hình (audio rỗng) → index kết thúc khi mảng hình hết.
5. Hai index liên tiếp đều có hình bắt đầu ngay → **không chớp đen** khi chuyển.
6. Câu hỏi chạm `tap4` → bấm đủ 4 vùng ra đúng 4 nhánh; bấm tâm và bấm ngoài vòng tròn đều ra `cham_khac`; không bấm gì 10 giây ra `silent`.
7. Câu hỏi chạm `swipe` → 4 hướng đúng; chạm không kéo ra `cham_khac`.
8. Vòng chờ: đỏ khi chờ nói, xanh lá khi chờ chạm, đè lên hình mà không xoá hình.
9. Node hỏi ở giữa mảng audio → các node audio sau nó không phát.
10. Index kiểu `"đọc giá trị đã lưu"` với hai mảng rỗng → không phát gì, rẽ nhánh ngay.
11. Chạm ngoài cửa sổ chờ → bị bỏ qua, không ảnh hưởng luồng.
12. File kịch bản cũ (không có `version`) vẫn chạy y như trước.

## 10. Ba câu hỏi kỹ thuật cần đội App trả lời sớm

1. **GIF có dừng được ở frame cuối không?** Cơ chế `repeat: 1` + `stop: "giu"` đòi hỏi dừng GIF sau một vòng và giữ frame cuối. Phần lớn thư viện hiển thị GIF trên vi điều khiển tự lặp vô hạn và không dừng được. Nếu không làm được, phải chuyển sang chuỗi frame (sprite) — và đội nội dung cần biết trước khi sản xuất.
2. **Ảnh nằm ở đâu, nạp lúc nào?** 360×360 khá nặng với thiết bị nhúng: tải sẵn toàn bộ ảnh của buổi trước khi bắt đầu, hay tải theo thời gian thực? Con số này ràng buộc trực tiếp **một buổi được dùng bao nhiêu ảnh khác nhau**, tức là ràng buộc lên cách viết kịch bản.
3. **Định dạng và dung lượng tối đa** cho ảnh tĩnh và GIF là gì?
