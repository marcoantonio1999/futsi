import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui/enrollment-ui";
import "./identityCrop.css";
import { detectIdentityBounds } from "./identityEdges";

type Box = { left: number; top: number; right: number; bottom: number };
const full: Box = {left: 0, top: 0, right: 100, bottom: 100};

function detect(source: ImageBitmap): Box {
  const scale = Math.min(1, 800 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d", {willReadFrequently: true});
  if (!context) return full;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return detectIdentityBounds(context.getImageData(0, 0, canvas.width, canvas.height));
}

export function IdentityCrop({file, onApply, onCancel}: {file: File; onApply: (file: File) => void; onCancel: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [sourceFile, setSourceFile] = useState(file);
  const [box, setBox] = useState<Box>(full);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(sourceFile);
    setUrl(objectUrl);
    if (!dialog.current?.open) dialog.current?.showModal();
    let active = true;
    createImageBitmap(sourceFile, {imageOrientation: "from-image"}).then(image => {
      if (active) setBox(detect(image));
      image.close();
    }).catch(() => { if (active) setError("No se pudo preparar la imagen."); });
    return () => { active = false; URL.revokeObjectURL(objectUrl); };
  }, [sourceFile]);

  async function rotate() {
    if (working) return;
    setWorking(true);
    try {
      const image = await createImageBitmap(sourceFile, {imageOrientation: "from-image"});
      const canvas = document.createElement("canvas"); canvas.width = image.height; canvas.height = image.width;
      const context = canvas.getContext("2d");
      if (!context) { image.close(); throw new Error(); }
      context.translate(canvas.width, 0); context.rotate(Math.PI / 2); context.drawImage(image, 0, 0); image.close();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error()), "image/jpeg", .94));
      setBox(full); setSourceFile(new File([blob], "ine-girada.jpg", {type:"image/jpeg"}));
    } catch { setError("No se pudo girar la imagen. Inténtalo de nuevo."); }
    finally { setWorking(false); }
  }

  async function apply() {
    if (working) return;
    setWorking(true);
    try {
      const image = await createImageBitmap(sourceFile, {imageOrientation: "from-image"});
      const x = Math.floor(image.width * box.left / 100), y = Math.floor(image.height * box.top / 100);
      const w = Math.max(1, Math.floor(image.width * box.right / 100) - x);
      const h = Math.max(1, Math.floor(image.height * box.bottom / 100) - y);
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const context = canvas.getContext("2d");
      if (!context) { image.close(); throw new Error(); }
      context.drawImage(image, x, y, w, h, 0, 0, w, h); image.close();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error()), "image/jpeg", .94));
      onApply(new File([blob], "ine-recortada.jpg", {type: "image/jpeg"}));
    } catch { setError("No se pudo recortar la imagen. Inténtalo de nuevo."); }
    finally { setWorking(false); }
  }
  const controls: {key: keyof Box; label: string}[] = [
    {key:"left", label:"Borde izquierdo"}, {key:"top", label:"Borde superior"},
    {key:"right", label:"Borde derecho"}, {key:"bottom", label:"Borde inferior"},
  ];
  return <Dialog ref={dialog} className="identity-crop-dialog" aria-label="Recortar INE" onCancel={event => {event.preventDefault(); onCancel();}}>
    <header><h2>Recortar INE</h2><Button type="button" onClick={onCancel} aria-label="Cerrar recorte">✕</Button></header>
    <p>Ajusta los bordes para que la credencial completa quede dentro del recuadro.</p>
    {url && <div className="identity-crop-image"><img src={url} alt="Escaneo del INE" />
      <div className="identity-crop-selection" style={{left:box.left+"%", top:box.top+"%", width:(box.right-box.left)+"%", height:(box.bottom-box.top)+"%"}} /></div>}
    <div className="identity-crop-controls">{controls.map(({key,label}) => <label key={key}>{label}
      <input type="range" min={0} max={100} value={box[key]} onChange={event => {
        const value = Number(event.target.value);
        setBox(current => ({...current, [key]: key === "left" ? Math.min(value,current.right-1) : key === "top" ? Math.min(value,current.bottom-1) : key === "right" ? Math.max(value,current.left+1) : Math.max(value,current.top+1)}));
      }} /></label>)}</div>
    {error && <p role="alert">{error}</p>}
    <footer><Button type="button" disabled={working} onClick={() => void rotate()}>Girar 90°</Button><Button type="button" onClick={() => setBox(full)}>Imagen completa</Button><Button type="button" onClick={onCancel}>Cancelar</Button><Button type="button" className="primary" disabled={working} onClick={() => void apply()}>Usar recorte</Button></footer>
  </Dialog>;
}
