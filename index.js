import { chromium } from "playwright";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME,
  TIKTOK_USERNAME,
} = process.env;

async function fetchAirtableRecords() {
  const response = await axios.get(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
    {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    }
  );
  return response.data.records.map(r => r.fields.URL);
}

async function uploadToAirtable(caption, videoUrl, filePath, location, datePosted, timePosted) {
  const formData = new FormData();
  formData.append(
    "fields",
    JSON.stringify({
      DatePosted: datePosted,
      TimePosted: timePosted,
      Attachments: videoUrl,
      Caption: caption,
      Location: location || "N/A",
    })
  );
  formData.append("file", fs.createReadStream(filePath));

  await axios.post(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
    formData,
    {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        ...formData.getHeaders(),
      },
    }
  );
  console.log("✅ Uploaded to Airtable successfully!");
}

async function run() {
  console.log("🚀 Starting TikTok automation...");

  const uploadedUrls = await fetchAirtableRecords();
  console.log(`Found ${uploadedUrls.length} existing records.`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("Opening TikTok profile...");
  await page.goto(`https://www.tiktok.com/@${TIKTOK_USERNAME}`, {
    waitUntil: "networkidle",
  });

  // Find the most recent video link
  const videoLink = await page.locator("a[href*='/video/']").first().getAttribute("href");
  const videoUrl = `https://www.tiktok.com${videoLink}`;

  if (uploadedUrls.includes(videoUrl)) {
    console.log("🟡 Video already uploaded to Airtable. Skipping.");
    await browser.close();
    return;
  }

  console.log(`🎥 Found new video: ${videoUrl}`);
  await page.goto(videoUrl, { waitUntil: "networkidle" });

  const caption = await page.locator("h1[data-e2e='browse-video-desc']").textContent();
  const videoSrc = await page.locator("video").getAttribute("src");

  // Try to get location if available
    let location = null;
    try {
    const locationElement = page.locator("[data-e2e='video-location']");
    if (await locationElement.count() > 0) {
        location = await locationElement.textContent();
    }
    } catch (err) {
    console.log("No location found for this video.");
    }

    // Parse TikTok's embedded JSON metadata for exact upload time
    const json = await page.locator("script#__NEXT_DATA__").textContent();
    const data = JSON.parse(json);
    const timestamp = data?.props?.pageProps?.itemInfo?.itemStruct?.createTime;

    let datePosted = null;
    let timePosted = null;

    if (timestamp) {
        const dateObj = new Date(timestamp * 1000); // TikTok timestamp is in seconds
        datePosted = dateObj.toISOString().split("T")[0]; // YYYY-MM-DD
        timePosted = dateObj.toISOString().split("T")[1].split(".")[0]; // HH:mm:ss
    }

  console.log("Downloading video...");
  const videoResponse = await axios.get(videoSrc, { responseType: "arraybuffer" });
  const filePath = "./latest_tiktok.mp4";
  fs.writeFileSync(filePath, videoResponse.data);

  await uploadToAirtable(caption, videoUrl, filePath, location, datePosted, timePosted);
  await browser.close();

  console.log("✅ Done!");
}

run().catch(console.error);
