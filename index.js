const express = require('express');
const fetch = require('node-fetch');
const QRCode = require('qrcode');
const crypto = require('crypto');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  if (req.body && req.body.challenge) {
    return res.status(200).json({
      challenge: req.body.challenge
    });
  }
  next();
});

const PORT = process.env.PORT || 3000;
const MONDAY_API_KEY = process.env.MONDAY_API_KEY || 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjMzMzg0NDUzNiwiYWFpIjoxMSwidWlkIjo1NzI1NDM4OSwiaWFkIjoiMjAyNC0wMy0xNlQxOTo1MTo1My4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTQ5Mjc2NzgsInJnbiI6InVzZTEifQ.GzG-PARLDqJnQBQkff9Nj95pWdbc9CTRziyF4QdFNH4';

// In-memory storage for shortened URLs
const urlDatabase = new Map();


// ==================== HELPER FUNCTIONS ====================

// Generate short code
function generateShortCode(length = 6) {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}


// ✅ FIXED: Update Monday.com column values
async function updateMondayColumns(itemId, boardId, columnValues) {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id: $boardId,
        item_id: $itemId,
        column_values: $columnValues
      ) {
        id
      }
    }
  `;

  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_API_KEY
    },
    body: JSON.stringify({
      query,
      variables: {
        boardId: boardId.toString(),
        itemId: itemId.toString(),
        // ✅ IMPORTANT: Only stringify ONCE
        columnValues: JSON.stringify(columnValues)
      }
    })
  });

  const result = await response.json();

  if (result.errors) {
    console.error("Monday column update error:", result.errors);
  }

  return result;
}


// Upload file to Monday.com
async function uploadFileToMonday(itemId, columnId, fileBuffer, fileName) {
  const FormData = require('form-data');
  const form = new FormData();

  const query = `
    mutation ($file: File!) {
      add_file_to_column (
        item_id: ${itemId},
        column_id: "${columnId}",
        file: $file
      ) {
        id
      }
    }
  `;

  const map = {
    "file": ["variables.file"]
  };

  form.append('query', query);
  form.append('map', JSON.stringify(map));
  form.append('file', fileBuffer, {
    filename: fileName,
    contentType: 'image/png'
  });

  const response = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: {
      "Authorization": MONDAY_API_KEY,
      ...form.getHeaders()
    },
    body: form
  });

  return await response.json();
}


// ==================== SHORTEN + QR + MONDAY WEBHOOK ====================

app.post('/api/shorten-with-qr', async (req, res) => {

  if (req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  try {
    const event = req.body.event;
    const itemId = event?.pulseId;
    const boardId = event?.boardId;

    if (!itemId || !boardId) {
      return res.status(400).json({
        success: false,
        message: "Missing itemId or boardId"
      });
    }

    // Respond immediately
    res.status(200).json({ success: true });

    // Fetch item
    const itemData = await getMondayItemData(itemId);
    const boardColumns = await getBoardColumns(boardId);

    const columnTitleMap = {};
    boardColumns.forEach(col => {
      columnTitleMap[col.id] = col.title;
    });

    let longUrl = null;

    for (const column of itemData.column_values) {
      if (column.type === 'link' && column.value) {
        const parsed = JSON.parse(column.value);
        longUrl = parsed.url;
        break;
      }
    }

    if (!longUrl) return;

    const shortCode = generateShortCode();
    urlDatabase.set(shortCode, {
      originalUrl: longUrl,
      shortCode,
      createdAt: new Date().toISOString(),
      clicks: 0
    });

    const shortUrl = `${req.protocol}://${req.get('host')}/s/${shortCode}`;

    const qrBuffer = await QRCode.toBuffer(shortUrl, { width: 500 });

    // Find columns
    const shortenedLinkColumn = boardColumns.find(col =>
      col.title.toLowerCase().includes('short')
    );

    const qrColumn = boardColumns.find(col =>
      col.title.toLowerCase().includes('qr')
    );

    const statusColumn = boardColumns.find(col =>
      col.title.toLowerCase() === 'status'
    );

    // ✅ Update Shortened Link
    if (shortenedLinkColumn) {
      await updateMondayColumns(itemId, boardId, {
        [shortenedLinkColumn.id]: {
          url: shortUrl,
          text: shortUrl
        }
      });
    }

    // Upload QR
    if (qrColumn) {
      await uploadFileToMonday(
        itemId,
        qrColumn.id,
        qrBuffer,
        `qr-${shortCode}.png`
      );
    }

    // ✅ Update Status to "Generated" (index 1)
    if (statusColumn) {
      await updateMondayColumns(itemId, boardId, {
        [statusColumn.id]: {
          index: 1
        }
      });
    }

  } catch (error) {
    console.error("Error:", error);
  }
});


// ==================== GET ITEM ====================

async function getMondayItemData(itemId) {
  const query = `
    query {
      items(ids: [${itemId}]) {
        id
        column_values {
          id
          text
          type
          value
        }
      }
    }
  `;

  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_API_KEY
    },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  return data?.data?.items?.[0] || null;
}

async function getBoardColumns(boardId) {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        columns {
          id
          title
          type
        }
      }
    }
  `;

  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_API_KEY
    },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  return data?.data?.boards?.[0]?.columns || [];
}


// ==================== REDIRECT ====================

app.get('/s/:shortCode', (req, res) => {
  const data = urlDatabase.get(req.params.shortCode);
  if (!data) return res.status(404).send("Not found");

  data.clicks++;
  res.redirect(data.originalUrl);
});


// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});