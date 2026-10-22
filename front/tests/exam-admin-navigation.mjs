export async function navigateExamSection(page, label) {
  const toggle = page.getByRole('button', { name: 'Abrir menú de exámenes', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: 'Menú de exámenes' }).filter({ visible: true })
    .getByRole('button', { name: label, exact: true }).click();
}
