import type { DemoPost } from "../data/demoPosts";

type EntityType = DemoPost["entities"][number]["type"];

const keywords = [
  "LINE",
  "虛擬貨幣",
  "保證獲利",
  "解除分期",
  "OTP",
  "指定帳戶",
  "保證金",
  "付款連結",
  "賣家認證",
  "安全帳戶",
  "穩賺不賠",
  "投資平台",
  "匯款",
  "假買家",
  "監管帳戶",
  "詐騙",
  "165",
];

export function getRiskKeywords() {
  return keywords;
}

export function normalizePost(input: {
  id: string;
  source: DemoPost["source"];
  board: string;
  title: string;
  content: string;
  url?: string;
  publishedAt?: string;
}): DemoPost {
  const entities = extractEntities(`${input.title} ${input.content}`);

  return {
    id: input.id,
    source: input.source,
    board: input.board,
    title: input.title,
    content: input.content,
    url: input.url,
    publishedAt: input.publishedAt,
    scamType: inferScamType(`${input.title} ${input.content}`),
    entities,
  };
}

export function inferScamType(text: string) {
  if (/(投資平台|保證獲利|虛擬貨幣|穩賺不賠)/i.test(text)) {
    return "假投資";
  }
  if (/(解除分期|OTP|客服)/i.test(text)) {
    return "解除分期";
  }
  if (/(保證金|兼職|打字)/i.test(text)) {
    return "求職詐騙";
  }
  if (/(賣家認證|付款連結|假買家)/i.test(text)) {
    return "假買家";
  }
  if (/(安全帳戶|監管帳戶|檢警)/i.test(text)) {
    return "假檢警";
  }
  if (/(交友軟體|戀愛|網友)/i.test(text)) {
    return "假交友投資";
  }

  return "疑似詐騙";
}

export function extractEntities(text: string) {
  const entityPatterns: Array<{
    type: EntityType;
    values: string[];
  }> = [
    {
      type: "channel",
      values: ["LINE", "Telegram", "WhatsApp", "Messenger", "客服電話", "來電"],
    },
    {
      type: "platform",
      values: ["網銀", "交友軟體", "投資平台", "二手平台", "Google News"],
    },
    {
      type: "keyword",
      values: keywords,
    },
    {
      type: "account",
      values: ["指定帳戶", "安全帳戶", "監管帳戶"],
    },
    {
      type: "money",
      values: ["匯款", "轉帳", "入金", "保證金"],
    },
  ];

  const entities = entityPatterns.flatMap((pattern) =>
    pattern.values
      .filter((value) => text.includes(value))
      .map((value) => ({
        type: pattern.type,
        value,
      })),
  );

  return uniqueEntities(entities);
}

function uniqueEntities(
  entities: Array<{
    type: EntityType;
    value: string;
  }>,
) {
  const seen = new Set<string>();

  return entities.filter((entity) => {
    const key = `${entity.type}:${entity.value}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
