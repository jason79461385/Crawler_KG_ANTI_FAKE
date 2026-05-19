export type DemoPost = {
  id: string;
  source: "PTT" | "Dcard" | "Google News" | "165 全民防騙網" | "User Report";
  board: string;
  title: string;
  content: string;
  url?: string;
  publishedAt?: string;
  scamType: string;
  entities: Array<{
    type: "platform" | "account" | "channel" | "keyword" | "money";
    value: string;
  }>;
};

export const demoPosts: DemoPost[] = [
  {
    id: "ptt-crypto-001",
    source: "PTT",
    board: "Gossiping",
    title: "有人用 LINE 揪投資虛擬貨幣，最後被要求持續加碼",
    content:
      "對方先在 LINE 主動接觸，說有內線名單可以帶做虛擬貨幣，保證獲利。後來要我匯款到指定帳戶，還一直催我加碼，說錯過就沒機會。",
    url: "https://www.ptt.cc/bbs/Gossiping/M.0000000001.AAAA.html",
    publishedAt: "2026-03-27T09:30:00.000Z",
    scamType: "假投資",
    entities: [
      { type: "channel", value: "LINE" },
      { type: "keyword", value: "虛擬貨幣" },
      { type: "keyword", value: "保證獲利" },
      { type: "account", value: "指定帳戶" },
    ],
  },
  {
    id: "ptt-installment-002",
    source: "PTT",
    board: "e-shopping",
    title: "客服說訂單設錯要解除分期，差點被騙",
    content:
      "接到自稱客服的電話，說因為訂單設定錯誤，要我操作網銀解除分期付款，還要求提供 OTP 驗證碼，幸好後來覺得不對勁。",
    url: "https://www.ptt.cc/bbs/e-shopping/M.0000000002.BBBB.html",
    publishedAt: "2026-03-26T09:30:00.000Z",
    scamType: "解除分期",
    entities: [
      { type: "keyword", value: "解除分期" },
      { type: "keyword", value: "OTP" },
      { type: "platform", value: "網銀" },
      { type: "channel", value: "客服電話" },
    ],
  },
  {
    id: "dcard-job-003",
    source: "Dcard",
    board: "工作",
    title: "兼職打字工作要求先匯保證金",
    content:
      "社團看到兼職打字工作，對方說要先付保證金才能領案子，還要我加 LINE 交接，後面又說帳號驗證失敗要再匯一次。",
    url: "https://www.dcard.tw/f/job/p/000000003",
    publishedAt: "2026-03-24T09:30:00.000Z",
    scamType: "求職詐騙",
    entities: [
      { type: "keyword", value: "保證金" },
      { type: "channel", value: "LINE" },
      { type: "keyword", value: "兼職" },
    ],
  },
  {
    id: "dcard-shopping-004",
    source: "Dcard",
    board: "網路購物",
    title: "假買家要求改用私訊交易並傳付款連結",
    content:
      "二手平台遇到假買家，對方要求我改用 LINE 私下交易，再傳一個假的付款驗證頁，說要先認證賣家帳號才能收款。",
    url: "https://www.dcard.tw/f/market/p/000000004",
    publishedAt: "2026-03-23T09:30:00.000Z",
    scamType: "假買家",
    entities: [
      { type: "channel", value: "LINE" },
      { type: "platform", value: "二手平台" },
      { type: "keyword", value: "付款連結" },
      { type: "keyword", value: "賣家認證" },
    ],
  },
  {
    id: "ptt-bank-005",
    source: "PTT",
    board: "Bank_Service",
    title: "假檢警說帳戶涉及洗錢，要我配合監管帳戶",
    content:
      "接到假檢警來電，說我的帳戶涉嫌洗錢，要我把錢轉到安全帳戶接受監管，還一直強調不能告訴家人或銀行。",
    url: "https://www.ptt.cc/bbs/Bank_Service/M.0000000005.CCCC.html",
    publishedAt: "2026-03-22T09:30:00.000Z",
    scamType: "假檢警",
    entities: [
      { type: "keyword", value: "安全帳戶" },
      { type: "channel", value: "來電" },
      { type: "account", value: "監管帳戶" },
    ],
  },
  {
    id: "dcard-relationship-006",
    source: "Dcard",
    board: "感情",
    title: "網友培養感情後要我一起投資平台",
    content:
      "在交友軟體認識的人每天聊天，之後推薦一個投資平台，說穩賺不賠，還教我先小額入金，後續一直要我追加。",
    url: "https://www.dcard.tw/f/relationship/p/000000006",
    publishedAt: "2026-03-20T09:30:00.000Z",
    scamType: "假交友投資",
    entities: [
      { type: "platform", value: "交友軟體" },
      { type: "keyword", value: "穩賺不賠" },
      { type: "keyword", value: "投資平台" },
      { type: "money", value: "小額入金" },
    ],
  },
];
