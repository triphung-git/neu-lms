import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_initial_migrations_reverse_and_forward_on_test_database_only():
    assert connection.vendor == "postgresql"
    assert connection.settings_dict["NAME"].startswith("test_"), (
        "Never reverse a development database"
    )
    executor = MigrationExecutor(connection)
    leaves = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([("platform_core", None), ("identity", None)])
        tables = connection.introspection.table_names()
        assert "identity_user" not in tables
        assert "platform_core_auditevent" not in tables
    finally:
        MigrationExecutor(connection).migrate(leaves)
    tables = connection.introspection.table_names()
    assert "identity_user" in tables and "platform_core_auditevent" in tables
    assert "auth_user" not in tables
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM identity_user")
        assert cursor.fetchone()[0] == 0
