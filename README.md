# OIL_WOS
WOS 주유계산기

## 집결 데이터

GitHub Pages 화면은 `rallies.json`을 주기적으로 읽어 집결 목록을 표시합니다.
게임 API 또는 봇 연동이 생기기 전까지는 아래 형식으로 `rallies` 배열을 갱신하면 됩니다.

```json
{
  "updatedAt": "2026-06-05T21:00:00+09:00",
  "rallies": [
    {
      "id": "rally-001",
      "title": "오일 필드 집결",
      "target": "오일 필드",
      "leader": "OIL",
      "startsAt": "2026-06-05T21:00:00+09:00",
      "endsAt": "2026-06-05T21:30:00+09:00",
      "note": "선택 메모"
    }
  ]
}
```
