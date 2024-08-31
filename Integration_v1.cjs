const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');

require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;  // Certifique-se de ter configurado a API_KEY corretamente

let browserInstance;

async function analyzeFileWithGemini(content, title, outputFilePath) {
    try {
        console.log(`Conteúdo analisado para ${title}: ${content}`);

        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: "Quero que me traga os principais insights a respeito das publicações deste documento" },
                            { text: content }
                        ]
                    }
                ]
            }),
        });

        const data = await response.json();

        // Verificar a resposta completa da API
        console.log('Resposta completa da API:', JSON.stringify(data, null, 2));

        // Verificar se a resposta da API está correta e contém os insights
        if (response.ok && data.candidates && data.candidates[0]) {
            const insightsObject = data.candidates[0].content;

            // Se insightsObject ainda for um objeto, converte-o para string
            const insights = typeof insightsObject === 'string' ? insightsObject : JSON.stringify(insightsObject, null, 2);

            // Salvar os insights no arquivo de saída
            const formattedInsights = `### ${title}\n\n${insights}\n\n`;
            await fs.appendFile(outputFilePath, formattedInsights);
            console.log(`Insights de ${title} salvos em ${outputFilePath}`);
        } else {
            console.error(`Erro na API do Gemini ou na estrutura da resposta: ${data.message || 'Formato inesperado da resposta'}`);
        }
    } catch (error) {
        console.error('Erro ao analisar o arquivo:', error);
    }
}


async function login(page) {
    await page.goto('https://www.linkedin.com/checkpoint/lg/sign-in-another-account');

    await page.waitForSelector('#username');
    await page.type('#username', process.env.LINKEDIN_EMAIL);
    
    await page.waitForSelector('#password');
    await page.type('#password', process.env.LINKEDIN_PASSWORD);
    
    await page.click('button[type="submit"]');

    try {
        await page.waitForNavigation({ timeout: 30000 });
    } catch (error) {
        console.error('Login falhou:', error);
        throw error;
    }
}

async function search_find(page, url, search, outputFilePath) {
    const profileUrl = url;

    try {
        await page.goto(profileUrl);

        const notFoundSelector = 'h1[aria-label="Profile unavailable"]';
        const isProfileNotFound = await page.evaluate((selector) => {
            return document.querySelector(selector) !== null;
        }, notFoundSelector);

        if (isProfileNotFound) {
            console.log(`Perfil para ${search} não encontrado.`);
            return;
        }

        await page.waitForSelector('main.scaffold-layout__main');

        // Rolar a página até o final para carregar todas as postagens, com um limite de 5 vezes
        let previousHeight;
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            previousHeight = await page.evaluate('document.body.scrollHeight');
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await page.waitForTimeout(2000); // Espera 2 segundos para o carregamento das novas postagens
            const newHeight = await page.evaluate('document.body.scrollHeight');
            if (newHeight === previousHeight) break; // Se não houver mudança na altura, sair do loop
            attempts++;
        }

        // Expandir todas as descrições que possuem "...more"
        const moreButtonsSelector = 'button.feed-shared-inline-show-more-text__see-more-less-toggle';
        const buttons = await page.$$(moreButtonsSelector);

        for (const button of buttons) {
            await button.click();
            await page.waitForTimeout(1000); // Aguarda um pouco para o conteúdo carregar
        }

        const divInnerText = await page.evaluate(() => {
            const div = document.querySelector('main.scaffold-layout__main');
            return div.innerText;
        }); 

        // Analisar o conteúdo com o Gemini
        await analyzeFileWithGemini(divInnerText, search, outputFilePath);
    } catch (error) {
        console.error(`Erro ao visitar ${search}:`, error);
    }
}


// Função que lê o arquivo e retorna uma lista de objetos com título e URL
async function readFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        const lines = data.trim().split('\n');
        const pesquisa = lines.map(line => {
            const [titulo, url] = line.split('\t'); // Supondo que os dados estão separados por tabulação (\t)
            return { titulo, url };
        });
        return pesquisa;
    } catch (error) {
        console.error('Erro ao ler o arquivo:', error);
        return [];
    }
}

// Função principal que lê o arquivo e executa a ação para cada item
async function Coleta_url() {
    const filePath = './Pesquisas-Linkedin.txt';
    const pesquisa = await readFile(filePath);
    return pesquisa;
}

(async () => {
    browserInstance = await puppeteer.launch({
        headless: false,
        // Argumentos adicionais do Puppeteer podem ser adicionados aqui, se necessário
    });

    const page = await browserInstance.newPage();
    await login(page);

    const pesquisa = await Coleta_url();
    const outputFilePath = './Linkedin_Insights.txt'; // Arquivo de saída único

    for (const { titulo, url } of pesquisa) {
        await search_find(page, url, titulo, outputFilePath);
    }

    await browserInstance.close();
})();
