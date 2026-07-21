/**
 * Expected values from the uploaded BOZZE RED (24).pdf sample.
 * Keep this file in tests/fixtures in the real repo if the original PDF cannot
 * be committed because it contains personal data.
 */
export const BOZZE_RED_24_EXPECTATIONS = [
  { page: 1, cf: 'FRMFRC91P22D086S', name: 'FORMICA FEDERICO', period: '202606', net: 2056.00, layout: 'employee' },
  { page: 2, cf: 'MRAMCN90E04D086C', name: 'MAURO MARCO ANTONIO', period: '202606', net: 1851.00, layout: 'collaborator' },
  { page: 3, cf: 'CNGVCN87D10C352W', name: 'CONIGLIO VINCENZO', period: '202606', net: 1839.00, layout: 'collaborator' },
  { page: 4, cf: 'RNLDTL96B41F915U', name: 'RINALDI DONATELLA', period: '202606', net: 1843.00, layout: 'employee' },
  { page: 5, cf: 'CNGRRT82H17D976X', name: 'CONIGLIO ROBERT', period: '202606', net: 1835.00, layout: 'employee' },
  { page: 6, cf: 'VCCLNZ00R24F839L', name: 'VACCARO LORENZO', period: '202606', net: 1050.00, layout: 'employee' },
  { page: 7, cf: 'PSQDNL94B18H769B', name: 'PASQUALETTI DANIELE', period: '202606', net: 1052.00, layout: 'employee' },
  { page: 8, cf: 'CLCSRA94H67C978F', name: 'CALCAGNILE SARA', period: '202606', net: 1109.00, layout: 'employee' },
  { page: 9, cf: 'SRGPQL94P07D086S', name: 'SERGIO PASQUALE', period: '202606', net: 1728.00, layout: 'employee' },
  { page: 10, cf: 'MPRMCL93S28A512P', name: 'IMPROTA MARCELLINO', period: '202606', net: 1841.00, layout: 'employee' },
  { page: 11, cf: 'CNDPLA95M03D086S', name: 'CUNDARI PAOLO', period: '202606', net: 1099.00, layout: 'employee' },
  { page: 12, cf: 'PNAVCN92P20C352A', name: 'PANAIA VINCENZO', period: '202606', net: 1720.00, layout: 'employee' },
] as const;
