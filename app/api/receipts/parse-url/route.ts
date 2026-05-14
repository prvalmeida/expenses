import { NextRequest, NextResponse } from 'next/server';
import { interpretAndCrossReference } from '../../../../lib/utils/receiptUtils';

const ALLOWED_KEYWORDS = ['sefaz', 'nfce', 'nfe', 'dfe'];

function isAllowedSefazUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.gov.br') &&
      ALLOWED_KEYWORDS.some(kw => url.hostname.includes(kw))
    );
  } catch {
    return false;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL não informada' }, { status: 400 });
    }

    if (!isAllowedSefazUrl(url)) {
      return NextResponse.json(
        {
          error:
            'URL não permitida. Informe um link de portal SEFAZ (domínio *.gov.br contendo sefaz, nfce, nfe ou dfe).',
        },
        { status: 400 }
      );
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Portal retornou HTTP ${response.status}. Verifique se o link está correto.` },
        { status: 502 }
      );
    }

    // Detect charset — some state portals still serve ISO-8859-1
    const contentType = response.headers.get('content-type') ?? '';
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
    const charset = charsetMatch?.[1] ?? 'utf-8';

    const buffer = await response.arrayBuffer();
    const html = new TextDecoder(charset).decode(buffer);
    const text = htmlToText(html);

    if (text.length < 200) {
      return NextResponse.json(
        {
          error:
            'Conteúdo insuficiente extraído. O portal pode exigir JavaScript ou a nota está indisponível.',
        },
        { status: 422 }
      );
    }

    const result = await interpretAndCrossReference(text);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: `Falha ao processar link: ${error}` }, { status: 500 });
  }
}
