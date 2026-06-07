import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    // 🟢 Ici, on ne demande que filePath et projectId
    const { filePath, projectId } = await req.json()
    if (!filePath || !projectId) throw new Error("Missing parameters for project initialization.")

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Téléchargement du fichier PO source
    const { data: fileData } = await supabaseAdmin.storage.from('po-files').download(filePath)
    if (!fileData) throw new Error("Source PO file unreadable.")

    const textContent = await fileData.text()
    const lines = textContent.split(/\r?\n/)

    const linesToInsert = []
    let currentMsgid = ""
    let currentMsgstr = ""
    let isReadingMsgid = false
    let isReadingMsgstr = false
    let sequenceCounter = 1 // 🔢 Initialisation du compteur pour le Carousel du Workspace

    const pushLineIfValid = () => {
      if (currentMsgid && currentMsgid.trim() !== "") {
        linesToInsert.push({
          project_id: projectId,
          msgid: currentMsgid,
          sequence_order: sequenceCounter++
        })
      }
    }

    // 2. Parsing du fichier PO
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('msgid ')) {
        isReadingMsgid = true; isReadingMsgstr = false
        currentMsgid = trimmed.substring(6).replace(/^"|"\s*$/g, '')
      } else if (trimmed.startsWith('msgstr ')) {
        isReadingMsgid = false; isReadingMsgstr = true
        currentMsgstr = trimmed.substring(7).replace(/^"|"\s*$/g, '')
      } else if (trimmed.startsWith('"')) {
        const content = trimmed.replace(/^"|"\s*$/g, '')
        if (isReadingMsgid) currentMsgid += content
        if (isReadingMsgstr) currentMsgstr += content
      } else if (trimmed === "" && currentMsgid) {
        pushLineIfValid()
        currentMsgid = ""; currentMsgstr = ""; isReadingMsgid = false; isReadingMsgstr = false
      }
    }
    pushLineIfValid() // Sécurité dernier bloc

    // 3. Insertion par paquets dans la table 'lines'
    if (linesToInsert.length > 0) {
      const BATCH_SIZE = 1000
      for (let i = 0; i < linesToInsert.length; i += BATCH_SIZE) {
        const batch = linesToInsert.slice(i, i + BATCH_SIZE)
        const { error: insertError } = await supabaseAdmin
          .from('lines')
          .insert(batch)
          
        if (insertError) throw new Error(`DB_LINES_INSERT_FAILED: ${insertError.message}`)
      }
    }

    return new Response(JSON.stringify({ success: true, totalImported: linesToInsert.length }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error("[CRITICAL INITIALIZATION ERROR]:", err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }
})