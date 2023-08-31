import { jsPDF } from "jspdf";
import { S3, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { configDotenv } from "dotenv";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";
import warmer from "lambda-warmer";

configDotenv()

function createUrl(baseUrl, resource) {
  if (resource === 'br') {
    return `${baseUrl}/${resource}`;
  }
  return baseUrl;
}

async function generatePDF(language, darkTheme) {
  try {
    const resumeUrl = createUrl(process.env.RESUME_SITE, language);

    const s3 = new S3({
      credentials: {
        accessKeyId: process.env.AWS_KEY,
        secretAccessKey: process.env.AWS_SECRET,
      },
      region: process.env.AWS_REGION_RESUME,
    });

    // const browser = await puppeteer.launch({
    //   args: [
    //     "--disable-setuid-sandbox",
    //     "--no-sandbox",
    //     "--single-process",
    //     "--no-zygote",
    //   ]
    // });

    const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
    })

    console.log("Puppeteer Connected.");

    const page = await browser.newPage();

    await page.goto(resumeUrl, {waitUntil: 'networkidle0'});

    console.log("Got into site")

    await page.waitForSelector("#area-cv");

    if (!darkTheme) await page.click('#theme-button')

    await page.setViewport({ width: 970, height: 955 });

    await page.evaluate(() => {
      const elementsToRemove = document.querySelectorAll(
        ".language-toggle-container"
      );
      elementsToRemove.forEach((element) => element.remove());
    
      const divToRemove = document.getElementById("tsparticles");
      if (divToRemove) {
        divToRemove.remove();
      }
    
      const elementsToRemove1 = document.querySelectorAll("#resume__generate");
      elementsToRemove1.forEach((element) => element.remove());
    
      const elementsToRemove2 = document.querySelectorAll("#theme-button");
      elementsToRemove2.forEach((element) => element.remove());
    
      const elementsToRemove3 = document.querySelectorAll("#snow-button");
      elementsToRemove3.forEach((element) => element.remove());
    });

    const element = await page.$("#area-cv");

    const pdf = await element.screenshot({ omitBackground: true });

    console.log('Took screenshot')

    const pdfFile =
      language === "br"
        ? new jsPDF({ format: [418, 240] })
        : new jsPDF({ format: [405, 240] });
    pdfFile.addImage(pdf, "PNG", 0, 0, 0, 0);

    console.log('PDF mounted')

    const pdfS3 = Buffer.from(pdfFile.output("arraybuffer"));

    console.log('PDF generated')

    const pages = await browser.pages()
    await Promise.all(pages.map(async (page) => page.close()))

    await browser.close();

    console.log('Browser closed')

    const fileName = uuidv4();

    console.log("Inserting PDF into database.");

    await s3
      .putObject({
        Bucket: process.env.AWS_BUCKET,
        Key: fileName,
        Body: pdfS3,
        ContentType: "application/pdf",
      })
      .catch((err) => {
        console.error(err);
      });

    console.log("Success.");

    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET,
      Key: fileName,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }).catch(
      (err) => {
        console.error(err);
        throw new Error("Error");
      }
    );

    console.log("URL generated");
    console.log(url)

    return url;
  } catch (err) {
    console.log(err);
    return err;
  }
};

async function defaultPDF() {
  try {
    const s3 = new S3({
      credentials: {
        accessKeyId: process.env.AWS_KEY,
        secretAccessKey: process.env.AWS_SECRET,
      },
      region: process.env.AWS_REGION_RESUME
    });
  
    const expires = 3600
  
    const command = new GetObjectCommand({Bucket: process.env.AWS_BUCKET, Key: 'Curriculum.pdf'})
    const url = await getSignedUrl(s3, command, {expiresIn: expires})
  
    console.log(`URL generated. expiring in ${expires}.`)
  
    return url;
  } catch (err) {
    console.log(err);
    return err;
  }
}

export const handler = async (event, context) => {
  try {
    const body = JSON.parse(event.body)
    const { language, darkTheme, defaultPdf, } = body

    if (await warmer(event)){return 'warmed'}
    else if (defaultPdf) {

      const defaultData = await defaultPDF()

      return {
        statusCode: 200,
        body: JSON.stringify({url: defaultData}),
        'Access-Control-Allow-Origin': '*'
    }

    }
    else {
      const data = await generatePDF(language, darkTheme)
  
      return {
          statusCode: 200,
          body: JSON.stringify({url: data}),
          'Access-Control-Allow-Origin': '*'
      }
    } 

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err,
      }),
    };
  }
};
