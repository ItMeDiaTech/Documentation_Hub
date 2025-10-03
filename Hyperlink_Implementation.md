## **Streamlined Summary: Hyperlink Fixing System**

### **Phase 1: ID Extraction**

The system scans hyperlinks for two types of identifiers:

**Content_ID Pattern:**

- Found when URL contains "TSRC" or "CMS"
- Format: `[TSRC|CMS]-[alphanumeric]-[6 digits]`
- Examples: `TSRC-a8923j-123456`, `CMS-C29-029394`

**Document_ID Pattern:**

- Found when URL contains "docid="
- Extracts everything after "=" until end or till anything but a non-alphanumeric or dash character
- Note: A hyperlink has either Content_ID OR Document_ID, never both

### **Phase 2: API Communication**

All extracted IDs are sent to PowerAutomate Flow:

```json
{
  "Lookup_ID": ["TSRC-xxx-123456", "docid_value", ...]
}
```

JSON REQUEST:
-We take every Content_ID and Document_ID that we found from all the hyperlinks, and add them to a single "List<string> Lookup_ID". So, Lookup_ID will hold all Document_ID and Content_ID we find. This gets sent to a PowerAutomate HTTP flow. There is no authentication of any kind, so to send the request we use:


This is written in C# and will need to be transposed to Typescript or whatever language is in use.
```
                    var jsonPayload = new
                    {
                        Lookup_ID = lookupIds
                    };

                    string jsonBody = JsonSerializer.Serialize(jsonPayload);

                    // Create HTTP request with configured settings
                    using var client = new HttpClient();
                    client.Timeout = TimeSpan.FromSeconds(_apiSettings.TimeoutSeconds);
                    client.DefaultRequestHeaders.Add("User-Agent", _apiSettings.UserAgent);

                    var content = new StringContent(jsonBody, System.Text.Encoding.UTF8, "application/json");

                    // Send request to Power Automate Flow
                    var response = await client.PostAsync(targetUrl, content);

                    if (response.IsSuccessStatusCode)
                    {
                        return await response.Content.ReadAsStringAsync();
                    }
```

JSON RESPONSE:
Response provides enriched data for each ID:
When we receive a JSON response back, it will look like:

```
{
  "StatusCode": "200",
  "Headers": {
    "Content-Type": "application/json"
  },
  "Body": {
    "Results": [
      {
        "Document_ID": "TSRC-2024-123456",
        "Content_ID": "CMS-2024-789012",
        "Title": "Document Title",
        "Status": "Active"
      }
    ],
    "Version": "2.1",
    "Changes": "Version update notes"
  }
}
```

-The version and changes part of it might be depricated at some point, so no need to worry about that info. Inside "Results" is where we want to look. Every Document_ID or Content_ID passed to the PowerAutomate flow will have these four fields returned: "Document_ID", "Content_ID", "Title", and "Status". (Be sure to trim any trailing whitespace after these variables!)

### **Phase 3: URL Reconstruction**

**Fixed URL Format:**

```text
https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=[Document_ID]
```

- After processing, only Document_ID is used in URLs (never Content_ID)
- URL is only updated if different from existing

### **Phase 4: Display Text Rules**

**Content_ID Appending (if enabled):**

- Adds last 6 digits of Content_ID as suffix: `Title (123456)`
- Handles existing partial IDs (4-5 digits) by padding zeros
- Removes duplicate spaces before appending

**Title Mismatch Updates (if enabled):**
**Title Mismatch Updates (if enabled):**

- Compares API title with current display text (minus Content_ID)
- Replaces with API title if different
  **Status Indicators:**

- `" - Not Found"`: Added when ID not returned by API
- `" - Expired"`: Added when Status (from json response) = "Expired"
- These append after Content_ID if present

### **Key Implementation Notes:**

### **Key Implementation Notes:**

1. Store hyperlink relationship IDs from OpenXML for proper updates
2. Always trim whitespace from all fields
3. Content_ID in display text only, Document_ID in URL only
4. Settings control whether to append/update Content_IDs and titles
