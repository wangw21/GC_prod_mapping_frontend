import unittest

from flask import Flask
from sqlalchemy import and_, or_

from app.models import SampleData, db
from app.routes.labeling import (
    EMPTY_FILTER_VALUE,
    SEARCH_FIELDS,
    ci_contains,
    parse_search_terms,
    resolve_search_fields,
    selected_value_condition,
)


class LabelingFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.config.update(
            SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(cls.app)
        cls.app_context = cls.app.app_context()
        cls.app_context.push()
        db.create_all()

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        db.drop_all()
        cls.app_context.pop()

    def setUp(self):
        db.session.query(SampleData).delete()
        db.session.add_all([
            SampleData(id=1, category='Hair Care', product_description='Apple SHAMPOO', sku='SKU-001', prod_attributes2=None),
            SampleData(id=2, category='Skin Care', product_description='Apple lotion', sku='TEST-002', prod_attributes2=''),
            SampleData(id=3, category='Body Care', product_description='Banana wash', sku='SKU_003', prod_attributes2='   '),
            SampleData(id=4, category='Hair Care', product_description='Apple conditioner', sku='SKU%004', prod_attributes2='Dry'),
        ])
        db.session.commit()

    def test_term_parser_preserves_phrases_and_removes_duplicates(self):
        terms, truncated = parse_search_terms('apple shampoo, SKU-001；APPLE SHAMPOO\nHair Care')
        self.assertEqual(terms, ['apple shampoo', 'SKU-001', 'Hair Care'])
        self.assertFalse(truncated)

    def test_search_fields_are_the_confirmed_three_fields(self):
        self.assertEqual(
            [field.key for field in SEARCH_FIELDS],
            ['product_description', 'sku', 'category'],
        )

    def test_empty_or_invalid_search_scope_falls_back_to_all_fields(self):
        names, fields = resolve_search_fields([])
        self.assertEqual(names, ['product_description', 'sku', 'category'])
        self.assertEqual([field.key for field in fields], names)

        invalid_names, invalid_fields = resolve_search_fields(['unknown'])
        self.assertEqual(invalid_names, names)
        self.assertEqual([field.key for field in invalid_fields], names)

    def test_search_scope_accepts_only_selected_fields_and_removes_duplicates(self):
        names, fields = resolve_search_fields(['sku', 'invalid', 'sku', 'category'])
        self.assertEqual(names, ['sku', 'category'])
        self.assertEqual([field.key for field in fields], names)

    def test_keyword_and_exclusion_scopes_can_be_independent(self):
        _, keyword_fields = resolve_search_fields(['product_description'])
        _, exclude_fields = resolve_search_fields(['category'])

        keyword_condition = or_(*(ci_contains(field, 'apple') for field in keyword_fields))
        exclude_condition = or_(*(ci_contains(field, 'skin') for field in exclude_fields))
        ids = [
            row.id for row in SampleData.query
            .filter(keyword_condition, ~exclude_condition)
            .order_by(SampleData.id).all()
        ]
        self.assertEqual(ids, [1, 4])

    def test_case_insensitive_all_terms_can_match_different_fields(self):
        terms = ['hair care', 'shampoo', 'sku-001']
        condition = and_(*[
            or_(*(ci_contains(field, term) for field in SEARCH_FIELDS))
            for term in terms
        ])
        ids = [row.id for row in SampleData.query.filter(condition).all()]
        self.assertEqual(ids, [1])

    def test_excluding_any_term_across_confirmed_fields(self):
        excluded = or_(*[
            ci_contains(field, term)
            for term in ('test-002', 'body care')
            for field in SEARCH_FIELDS
        ])
        ids = [row.id for row in SampleData.query.filter(~excluded).order_by(SampleData.id).all()]
        self.assertEqual(ids, [1, 4])

    def test_like_wildcards_are_treated_as_literal_characters(self):
        percent_ids = [row.id for row in SampleData.query.filter(ci_contains(SampleData.sku, 'sku%004')).all()]
        underscore_ids = [row.id for row in SampleData.query.filter(ci_contains(SampleData.sku, 'sku_003')).all()]
        self.assertEqual(percent_ids, [4])
        self.assertEqual(underscore_ids, [3])

    def test_empty_attribute_matches_null_empty_and_whitespace(self):
        condition = selected_value_condition(SampleData.prod_attributes2, [EMPTY_FILTER_VALUE])
        ids = [row.id for row in SampleData.query.filter(condition).order_by(SampleData.id).all()]
        self.assertEqual(ids, [1, 2, 3])

    def test_empty_attribute_can_be_combined_with_normal_values(self):
        condition = selected_value_condition(SampleData.prod_attributes2, [EMPTY_FILTER_VALUE, 'Dry'])
        ids = [row.id for row in SampleData.query.filter(condition).order_by(SampleData.id).all()]
        self.assertEqual(ids, [1, 2, 3, 4])

    def test_douyin_uses_product_url_even_when_sku_url_exists(self):
        sample = SampleData(eRetailer=' douyin ', url='https://douyin.example/product', sku_url='https://example.com/sku')
        self.assertEqual(sample.preferred_link, 'https://douyin.example/product')

    def test_douyin_does_not_fall_back_to_sku_url(self):
        sample = SampleData(eRetailer='DOUYIN', url='  ', sku_url='https://example.com/sku')
        self.assertIsNone(sample.preferred_link)

    def test_other_eretailers_prefer_sku_url_then_product_url(self):
        with_sku_url = SampleData(eRetailer='TMALL', url='https://example.com/product', sku_url='https://example.com/sku')
        without_sku_url = SampleData(eRetailer=None, url='https://example.com/product', sku_url='')
        without_links = SampleData(eRetailer='JD', url=None, sku_url=None)

        self.assertEqual(with_sku_url.preferred_link, 'https://example.com/sku')
        self.assertEqual(without_sku_url.preferred_link, 'https://example.com/product')
        self.assertIsNone(without_links.preferred_link)


if __name__ == '__main__':
    unittest.main()
