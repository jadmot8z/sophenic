"""Extract bounded, visible DOM and retain actual node handles, not CSS from the LLM."""

ELEMENTS_JS = r"""() => {
 const selectors = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]';
 return [...document.querySelectorAll(selectors)].filter(el => {
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= innerHeight &&
    r.right >= 0 && r.left <= innerWidth && s.visibility !== 'hidden' && s.display !== 'none';
 }).slice(0, 80);
}"""
DESCRIBE_JS = r"""el => ({
 tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '',
 label: (el.getAttribute('aria-label') || (el.labels && [...el.labels].map(l=>l.innerText).join(' ')) ||
   el.innerText || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || el.getAttribute('data-tooltip') || '').slice(0,160),
 type: el.type || el.getAttribute('type') || '', disabled: !!el.disabled,
 title: (el.getAttribute('title') || el.getAttribute('data-tooltip') || '').slice(0,160),
 autocomplete: el.getAttribute('autocomplete') || '',
 form_role: el.closest('form')?.getAttribute('role') || '',
 href: (el.getAttribute('href') || '').slice(0,1500),
 options: el.tagName === 'SELECT' ? [...el.options].slice(0,40).map(o=>({label:o.label,value:o.value})) : []
})"""


async def parse_dom(page, generation):
    array = await page.evaluate_handle(ELEMENTS_JS)
    properties = await array.get_properties()
    handles, elements = {}, []
    try:
        for index, handle in properties.items():
            node = handle.as_element()
            if node is None:
                await handle.dispose()
                continue
            identifier = f"e{generation}-{index}"
            description = await node.evaluate(DESCRIBE_JS)
            handles[identifier] = node
            elements.append({"id": identifier, **description})
    except BaseException:
        for handle in properties.values():
            await handle.dispose()
        raise
    finally:
        await array.dispose()
    return handles, elements


VIEWPORT_TEXT_JS = r"""() => {
 const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
 const result = []; let node, visited = 0, length = 0;
 while ((node = walker.nextNode()) && visited++ < 15000 && length < 12000) {
  const el = node.parentElement;
  if (!el || ['SCRIPT','STYLE','NOSCRIPT'].includes(el.tagName)) continue;
  const text = node.textContent.trim(); if (!text) continue;
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  if (r.width && r.height && r.bottom >= 0 && r.top <= innerHeight &&
      s.visibility !== 'hidden' && s.display !== 'none') {
    result.push(text); length += text.length;
  }
 }
 return result.join(' ').slice(0,12000);
}"""
