import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS Preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { filePath, projectId } = await req.json()

    if (!filePath || !projectId) {
      return new Response(JSON.stringify({ error: "Missing filePath or projectId parameter." }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    // Connect to your Supabase instance internally using admin service role credentials
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Download the raw .po file from the 'po-files' storage bucket
    const { data: fileData, error: downloadError } = await supabaseAdmin
      .storage
      .from('po-files')
      .download(filePath)

    if (downloadError || !fileData) {
      throw new Error(`Failed to fetch file from storage: ${downloadError?.message}`)
    }

    const textContent = await fileData.text()
    
    // 2. Perform server-side line parsing
    const lines = textContent.split(/\r?\n/)
    const linesPayload = []
    let currentMsgid = ""
    let isReadingMsgid = false;
    let sequenceOrder = 1

    for (let line of lines) {
      line = line.trim()
      
      if (line.startsWith('#')) continue

      if (line.startsWith('msgid "')) {
        isReadingMsgid = true
        currentMsgid = line.substring(7, line.length - 1)
      } else if (line.startsWith('"') && isReadingMsgid) {
        currentMsgid += line.substring(1, line.length - 1)
      } else if (line.startsWith('msgstr "')) {
        isReadingMsgid = false
        if (currentMsgid && currentMsgid.trim() !== "") {
          // Push formatted record object directly matching the image_ee11e1.png database schema
          linesPayload.push({
            project_id: parseInt(projectId, 10),
            msgid: currentMsgid,
            sequence_order: sequenceOrder++
          })
        }
        currentMsgid = ""
      }
    }

    // 3. Ingest records back into the database in chunks of 5000 rows
    const CHUNK_SIZE = 5000
    for (let i = 0; i < linesPayload.length; i += CHUNK_SIZE) {
      const chunk = linesPayload.slice(i, i + CHUNK_SIZE)
      const { error: insertError } = await supabaseAdmin
        .from('lines')
        .insert(chunk)

      if (insertError) throw insertError
    }

    return new Response(
      JSON.stringify({ success: true, totalImported: linesPayload.length }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})